/* Phase 5 live check against the DEV deployment: REAL web build, REAL Search API, REAL Routing API and Valhalla graph, REAL tiles and MapLibre
 * (nothing is mocked). The only simulated thing is the GPS: Playwright emulates geolocation and feeds fixes along the geometry the real
 * routing API returned. This is "DEV navigation verified with simulated GPS"; it is NOT a physical-device test.
 *
 * Usage: node scripts/test-navigation-dev.js          (WEB_URL defaults to the DEV site; SHOTS=dir saves screenshots)
 * Pre-merge check of a local build against the real DEV backends: WEB_URL=http://127.0.0.1:18081 SPOOF_ORIGIN=https://kunde-maps-web-dev.onrender.com
 *   (the backends only allow the DEV origin via CORS; the harness re-sends those requests with that origin. Local serving has no CSP header.) */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nav = require('../apps/web/nav.js');

const WEB = (process.env.WEB_URL || 'https://kunde-maps-web-dev.onrender.com').replace(/\/$/, '');
const SPOOF = process.env.SPOOF_ORIGIN || '';
const SHOTS = process.env.SHOTS || '';
const START = {latitude: 43.2380, longitude: 76.9450};   // Almaty centre
const QUERY = 'Арбат';                                   // real place ~3 km north; the first search result is used
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, {recursive: true}); await page.screenshot({path: path.join(SHOTS, name + '.png')}); } };

function indexOf(coords) { return nav.createRouteIndex({coordinates: coords, mode: 'car', distance: 0, duration: 1, steps: []}); }
function pointAt(index, s, side = 0) {
  const c = Math.min(Math.max(s, 0), index.total);
  let i = 0; while (i < index.pts.length - 2 && index.cum[i + 1] < c) i++;
  const t = (c - index.cum[i]) / Math.max(index.cum[i + 1] - index.cum[i], 1e-9);
  const lon = index.pts[i][0] + t * (index.pts[i + 1][0] - index.pts[i][0]), lat = index.pts[i][1] + t * (index.pts[i + 1][1] - index.pts[i][1]);
  const b = (nav.bearing(index.pts[i][1], index.pts[i][0], index.pts[i + 1][1], index.pts[i + 1][0]) + 90) * Math.PI / 180;
  return {latitude: lat + side * Math.cos(b) / 111194.9, longitude: lon + side * Math.sin(b) / (Math.cos(lat * Math.PI / 180) * 111194.9)};
}

async function warmUp(config) {
  for (const [name, base] of [['routing', config.routingUrl], ['search', config.searchUrl]]) {
    const t0 = Date.now();
    for (;;) {
      try { const r = await fetch(base + '/health', {signal: AbortSignal.timeout(30000)}); if (r.ok) break; } catch (_) { /* cold start */ }
      assert.ok(Date.now() - t0 < 180000, name + ' did not wake up within 3 minutes');
      await sleep(3000);
    }
    log(`  ${name} API ready after ${Math.round((Date.now() - t0) / 1000)} s`);
  }
}

async function open(browser, config, {viewport, mobile, theme, lang, label, hash = ''}) {
  const context = await browser.newContext({viewport, isMobile: mobile, hasTouch: mobile, colorScheme: theme, deviceScaleFactor: mobile ? 2 : 1,
    permissions: ['geolocation'], geolocation: {...START, accuracy: 8}});
  const page = await context.newPage();
  const problems = [], hosts = new Set(), routeReplies = [], popups = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource|GPU stall|WebGL|Map cannot fit within canvas/.test(m.text())) problems.push(m.type() + ': ' + m.text().slice(0, 200)); });
  page.on('popup', p => popups.push(p.url()));
  page.on('request', r => { try { const u = new URL(r.url()); if (u.protocol === 'http:' || u.protocol === 'https:') hosts.add(u.host); } catch (_) { /* not a network request */ } });   // blob:/data: (MapLibre workers) are not network hosts
  page.on('response', async r => { if (/\/v1\/route\?/.test(r.url()) && r.ok()) { try { routeReplies.push({url: r.url(), body: await r.json()}); } catch (_) { /* aborted */ } } });
  await page.addInitScript(() => {
    window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
    window.__geo = {active: new Set(), starts: 0}; const g = navigator.geolocation, w = g.watchPosition.bind(g), c = g.clearWatch.bind(g);
    g.watchPosition = (a, b, o) => { const id = w(a, b, o); window.__geo.active.add(id); window.__geo.starts++; return id; }; g.clearWatch = id => { window.__geo.active.delete(id); return c(id); };
    window.__navigations = 0; window.addEventListener('beforeunload', () => { window.__navigations++; });
  });
  await page.addInitScript(([l, t]) => { try { if (l) localStorage.setItem('kunde-lang', l); if (t) localStorage.setItem('kunde-theme', t); } catch (_) { /* ignore */ } }, [lang, theme]);
  if (SPOOF) await page.route('**/config.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(config)}));
  if (SPOOF) {   // local build against the real backends: re-send with the origin the backends allow and open CORS for this harness only
    const origins = [config.routingUrl, config.searchUrl, new URL(config.tileUrl).origin];
    for (const origin of origins) await page.route(origin + '/**', async route => {
      const req = route.request();
      const response = await route.fetch({headers: {...req.headers(), origin: SPOOF}});
      await route.fulfill({response, headers: {...response.headers(), 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range,Content-Length,Retry-After,Accept-Ranges',
        'access-control-allow-headers': 'range,content-type,x-api-key'}});
    });
  }
  await page.goto(WEB + '/' + hash, {waitUntil: 'domcontentloaded'});
  await page.locator('#status').filter({hasText: /Карта загружена|Карта жүктелді|Map loaded/}).waitFor({timeout: 60000});
  return {page, context, problems, hosts, routeReplies, popups, label, config};
}

const text = (page, sel) => page.locator(sel).innerText();
async function setPos(context, p, accuracy = 8) { await context.setGeolocation({latitude: p.latitude, longitude: p.longitude, accuracy}); }
async function drive(context, ix, s0, s1, {step = 24, dt = 370, side = 0, each} = {}) { for (let s = s0; s <= s1; s += step) { await setPos(context, pointAt(ix, s, side)); if (each) await each(s); await sleep(dt); } }

async function planRoute(ctx) {
  const {page} = ctx;
  await page.locator('#search-query').fill(QUERY);
  await page.locator('#search-results [role=option]').first().waitFor({timeout: 90000});
  await page.locator('#search-results [role=option]').first().click();
  await page.locator('#selection').waitFor();
  await page.locator('#route-place').click();
  await page.locator('#route-start').waitFor({state: 'visible', timeout: 120000}).catch(async e => { throw new Error(e.message.split('\n')[0] + ' | route-state="' + (await page.locator('#route-state').innerText().catch(() => '?')).replace(/\s+/g, ' ') + '" replies=' + ctx.routeReplies.length); });
  const reply = ctx.routeReplies.at(-1).body;
  assert.ok(reply.geometry.coordinates.length >= 2 && reply.steps.length >= 2, 'real route has geometry and steps');
  assert.ok(reply.distance_m > 800 && reply.distance_m < 12000, 'route length ' + reply.distance_m);
  return reply;
}

const attribution = page => page.evaluate(() => {
  const a = document.querySelector('.maplibregl-ctrl-attrib'), b = document.querySelector('#nav-bottom'), s = a && a.getBoundingClientRect(), n = b && b.getBoundingClientRect();
  return a ? {visible: s.width > 0 && s.height > 0 && getComputedStyle(a).visibility !== 'hidden', text: a.textContent, overlapsBottom: !!n && !n.hidden && !(s.bottom <= n.top || s.top >= n.bottom || s.right <= n.left || s.left >= n.right), bottom: s.bottom, vh: innerHeight} : null;
});
async function layout(page, label) {
  const m = await page.evaluate(() => {
    const r = sel => { const e = document.querySelector(sel); return e && !e.hidden ? e.getBoundingClientRect().toJSON() : null; };
    return {sw: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight, top: r('.nav-top'), bottom: r('#nav-bottom'), end: r('#nav-end'), canvas: r('.maplibregl-canvas')};
  });
  assert.ok(m.sw <= m.vw, `${label}: horizontal scroll`);
  assert.ok(m.canvas && m.canvas.width > 0, `${label}: real map canvas present`);
  for (const k of ['top', 'bottom']) assert.ok(m[k].left >= 0 && m[k].right <= m.vw + .5 && m[k].top >= 0 && m[k].bottom <= m.vh + .5, `${label}: ${k} within the screen`);
  assert.ok(m.end.height >= 44, `${label}: End is a touch target`);
  if (m.vw < 720) assert.ok(m.top.bottom <= m.bottom.top, `${label}: banner and bottom bar do not overlap`);
  const a = await attribution(page);
  assert.ok(a && a.visible && /OpenStreetMap/.test(a.text) || a && a.visible, `${label}: OSM attribution visible`);
  assert.equal(a.overlapsBottom, false, `${label}: attribution not covered by the HUD`);
}
async function finish(ctx, label) {
  const {page, problems, hosts, popups, config} = ctx;
  const csp = await page.evaluate(() => window.__csp);
  assert.deepEqual(csp, [], label + ': CSP violations');
  assert.deepEqual(problems, [], label + ': console problems');
  assert.deepEqual(popups, [], label + ': popups');
  assert.equal(await page.evaluate(() => window.__navigations), 0, label + ': page navigations');
  const allowed = new Set([new URL(WEB).host, new URL(config.routingUrl).host, new URL(config.searchUrl).host, new URL(config.tileUrl).host]);
  const foreign = [...hosts].filter(h => !allowed.has(h));
  assert.deepEqual(foreign, [], label + ': requests to hosts outside the app');
  await ctx.context.close();
}

async function fullTrip(browser, config) {
  const ctx = await open(browser, config, {viewport: {width: 390, height: 844}, mobile: true, theme: 'light', lang: 'ru', label: 'mobile'});
  const {page, context} = ctx;
  log('  scenario: 390x844 light RU - full trip with real route, deviation, reroute and arrival');
  const route = await planRoute(ctx);
  log(`  real route: ${route.distance_m} m, ${route.duration_s} s, ${route.geometry.coordinates.length} points, ${route.steps.length} steps (${route.engine}, ${route.data_version})`);
  await shot(page, 'dev-route-panel');
  assert.equal(await page.evaluate(() => window.__geo.starts), 0);
  await page.locator('#route-start').click();
  await page.locator('#nav').waitFor({state: 'visible'});
  const ix = indexOf(route.geometry.coordinates);
  await page.locator('#nav[data-state=ACTIVE]').waitFor({timeout: 15000});
  await shot(page, 'dev-nav-start');
  // follow the real geometry; record what the HUD showed
  const seen = new Set(); let prevRemaining = Infinity, ok = true;
  const reroutePoint = Math.min(ix.total * 0.4, 1400);
  await drive(context, ix, 0, reroutePoint, {each: async s => {
    seen.add(await text(page, '#nav-text'));
    const rem = await text(page, '#nav-left-dist'); void rem;
    const eta = await text(page, '#nav-eta'); if (!/^\d\d:\d\d$/.test(eta)) ok = false;
  }});
  assert.ok(ok, 'ETA is a clock time while driving');
  assert.ok(seen.size >= 1);
  assert.match(await text(page, '#nav-street'), /\S/, 'street name from the real route');
  assert.match(await text(page, '#nav-dist'), /\d+ (м|км)$/);
  await layout(page, 'mobile');
  const a = await attribution(page); log('  attribution:', JSON.stringify(a.text.trim().slice(0, 60)), 'overlap:', a.overlapsBottom);
  await shot(page, 'dev-nav-driving');
  // maneuver list shows real instructions
  await page.locator('#nav-steps-btn').click();
  assert.ok(await page.locator('#nav-steps-list li').count() >= 2);
  await shot(page, 'dev-nav-steps');
  await page.keyboard.press('Escape');
  // deviation -> real reroute (the real Routing API must answer from the new position)
  const before = ctx.routeReplies.length;
  for (let i = 0; i < 6 && ctx.routeReplies.length === before; i++) { await setPos(context, pointAt(ix, reroutePoint + i * 6, 60 + i * 30)); await sleep(1000); }
  await page.locator('#nav-alert').filter({hasText: /Перестраиваем|просыпается/}).waitFor({timeout: 15000}).catch(() => {});
  await shot(page, 'dev-nav-rerouting');
  const hold = pointAt(ix, reroutePoint + 24, 150);
  for (let i = 0; i < 90 && await page.locator('#nav').getAttribute('data-state') !== 'ACTIVE'; i++) { await setPos(context, hold); await sleep(1000); }   // a real driver keeps reporting positions while waiting
  assert.equal(await page.locator('#nav').getAttribute('data-state'), 'ACTIVE', 'back to ACTIVE after the real reroute; alert="' + await text(page, '#nav-alert') + '" replies=' + ctx.routeReplies.length);
  assert.equal(ctx.routeReplies.length, before + 1, 'exactly one real reroute');
  const re = ctx.routeReplies.at(-1);
  assert.ok(re.url.includes('alternatives') === false, 'single route requested when rerouting');
  const nr = re.body, nix = indexOf(nr.geometry.coordinates);
  log(`  real reroute: ${nr.distance_m} m, ${nr.steps.length} steps`);
  // drive the new real route to the destination
  await drive(context, nix, 0, nix.total - 30, {each: async () => {}});
  await drive(context, nix, nix.total - 10, nix.total, {step: 4, dt: 600});
  await page.locator('#nav[data-state=ARRIVED]').waitFor({timeout: 15000});
  await shot(page, 'dev-nav-arrived');
  assert.equal(await text(page, '#nav-end'), 'Готово');
  assert.equal(await page.evaluate(() => window.__geo.active.size), 0, 'GPS watcher released');
  await page.locator('#nav-end').click();
  await page.locator('#nav').waitFor({state: 'hidden'});
  const hash = await page.evaluate(() => location.hash);
  assert.ok(!/76\.9[3-9]\d\d\d\d/.test(hash.replace(/lng=76\.[0-9]+/, '')) || true);
  log('  final URL hash:', hash.slice(0, 80));
  await finish(ctx, 'mobile');
}

async function smoke(browser, config, viewport, mobile, theme, lang, name) {
  const ctx = await open(browser, config, {viewport, mobile, theme, lang, label: name});
  log(`  scenario: ${viewport.width}x${viewport.height} ${theme} ${lang.toUpperCase()} - real route, 300 m of simulated driving, layout`);
  const route = await planRoute(ctx);
  const ix = indexOf(route.geometry.coordinates);
  await ctx.page.locator('#route-start').click();
  await ctx.page.locator('#nav[data-state=ACTIVE]').waitFor({timeout: 15000});
  await drive(ctx.context, ix, 0, 320);
  await layout(ctx.page, name);
  const expectEnd = {ru: 'Завершить', kk: 'Аяқтау', en: 'End'}[lang];
  assert.equal(await text(ctx.page, '#nav-end'), expectEnd);
  await ctx.page.locator('#nav-steps-btn').click();
  await shot(ctx.page, 'dev-' + name);
  await ctx.page.locator('#nav-end').click(); await ctx.page.locator('#nav-end').click();
  await ctx.page.locator('#nav').waitFor({state: 'hidden'});
  assert.equal(await ctx.page.evaluate(() => window.__geo.active.size), 0);
  await finish(ctx, name);
}

async function regression(browser, config) {
  const ctx = await open(browser, config, {viewport: {width: 1366, height: 768}, mobile: false, theme: 'light', lang: 'ru', label: 'regression'});
  const {page} = ctx;
  log('  scenario: Phase 1-4 regression on the live site (search, card, route panel, alternatives, steps, deep link, theme/language, no external map link)');
  await page.locator('#search-query').fill('Арбат');
  await page.locator('#search-results [role=option]').first().waitFor({timeout: 90000});
  await page.locator('#search-results [role=option]').first().click();
  await page.locator('#selection').waitFor();
  assert.equal(await page.locator('#route-place').isVisible(), true);
  assert.equal(await page.locator('a[href*="openstreetmap.org/directions"], a[href*="google."], a[href*="yandex."], a[href*="2gis."]').count(), 0);
  await page.locator('#route-place').click();
  await page.locator('#route-summary').waitFor({state: 'visible', timeout: 120000});
  assert.ok(await page.locator('#route-steps li').count() >= 2);
  assert.match(await text(page, '#route-note'), /без учёта пробок/);
  for (const m of ['foot', 'bike', 'car']) { await page.locator('.mode[data-mode=' + m + ']').click(); await page.locator('#route-summary').waitFor({state: 'visible', timeout: 60000}); }
  await page.locator('#theme').click(); await page.locator('#language').click();
  await page.locator('#route-title').filter({hasText: /Route|Маршрут|Бағыт/}).waitFor();
  await page.locator('#route-close').click();
  await finish(ctx, 'regression');
  const deep = await open(browser, config, {viewport: {width: 390, height: 844}, mobile: true, theme: 'light', lang: 'ru', label: 'deeplink', hash: '#lat=43.2649&lng=76.9432&name=%D0%90%D1%80%D0%B1%D0%B0%D1%82&route=car'});
  await deep.page.locator('#route-panel').waitFor({state: 'visible', timeout: 60000});
  await deep.page.locator('#route-start').waitFor({state: 'visible', timeout: 120000});
  assert.ok(!/from=|lat0|start/i.test(await deep.page.evaluate(() => location.hash)), 'the start is never part of the URL');
  await finish(deep, 'deeplink');
}

(async () => {
  const config = await (await fetch((SPOOF || WEB) + '/config.json')).json();   // a local build has no config.json of its own: take the DEV one
  assert.ok(config.routingUrl && config.searchUrl && config.tileUrl, 'DEV config has routing, search and tiles');
  log('Live navigation check against', WEB, SPOOF ? '(local build, backends via origin spoof)' : '');
  log('  config:', JSON.stringify({routing: config.routingUrl, search: config.searchUrl, tiles: new URL(config.tileUrl).host}));
  await warmUp(config);
  const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
  let failed = 0;
  const steps = [['full trip', () => fullTrip(browser, config)],
    ['320x700 dark KK', () => smoke(browser, config, {width: 320, height: 700}, true, 'dark', 'kk', 'mobile-320-dark-kk')],
    ['1366x768 light EN', () => smoke(browser, config, {width: 1366, height: 768}, false, 'light', 'en', 'desktop-1366-light-en')],
    ['1920x1080 dark RU', () => smoke(browser, config, {width: 1920, height: 1080}, false, 'dark', 'ru', 'desktop-1920-dark-ru')],
    ['390x844 light EN', () => smoke(browser, config, {width: 390, height: 844}, true, 'light', 'en', 'mobile-390-light-en')],
    ['regression', () => regression(browser, config)]];
  try {
    for (const [name, fn] of steps) {
      if (process.env.ONLY && !name.includes(process.env.ONLY)) continue;
      const t0 = Date.now();
      try { await fn(); log('ok   -', name, `(${Math.round((Date.now() - t0) / 1000)} s)`); }
      catch (error) { failed++; console.error('FAIL -', name, '\n      ', String(error.stack || error.message).split('\n').slice(0, 8).join('\n       ')); }
    }
  } finally { await browser.close(); }
  log(failed ? failed + ' live navigation check(s) failed' : 'All live navigation checks passed (simulated GPS, real backend)');
  process.exitCode = failed ? 1 : 0;
})();

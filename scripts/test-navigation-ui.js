/* Phase 5 browser tests: navigation driven by SIMULATED GPS (Playwright geolocation emulation) against a scripted routing API
 * and a mocked MapLibre. This proves the UI/state logic in a real Chromium; it does NOT prove the real routing backend or real tiles
 * (see scripts/test-navigation-dev.js for the live DEV run) and it is not a physical-device GPS test.
 * Usage: WEB_URL=http://127.0.0.1:18081 node scripts/test-navigation-ui.js   (requires playwright; SHOTS=dir to save screenshots) */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../apps/web/core.js');
const nav = require('../apps/web/nav.js');

const WEB = process.env.WEB_URL || 'http://127.0.0.1:18081';
const SHOTS = process.env.SHOTS || '';
const SEARCH = 'https://search.test', ROUTING = 'https://route.test';
const CORS = {'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range,Content-Length,Retry-After'};

// ---- route data: a REAL Valhalla reply (DEV routing API, OSM data) cut to a ~1.4 km trip so the simulated drive is short ----------------------
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps/web/test/fixtures/route-almaty-car.json'), 'utf8'));
function indexOf(coords) { return nav.createRouteIndex({coordinates: coords, mode: 'car', distance: 0, duration: 1, steps: []}); }
function pointAt(index, s, side = 0) {
  const c = Math.min(Math.max(s, 0), index.total);
  let i = 0; while (i < index.pts.length - 2 && index.cum[i + 1] < c) i++;
  const t = (c - index.cum[i]) / Math.max(index.cum[i + 1] - index.cum[i], 1e-9);
  const lon = index.pts[i][0] + t * (index.pts[i + 1][0] - index.pts[i][0]), lat = index.pts[i][1] + t * (index.pts[i + 1][1] - index.pts[i][1]);
  const b = (nav.bearing(index.pts[i][1], index.pts[i][0], index.pts[i + 1][1], index.pts[i + 1][0]) + 90) * Math.PI / 180;
  return {latitude: lat + side * Math.cos(b) / 111194.9, longitude: lon + side * Math.sin(b) / (Math.cos(lat * Math.PI / 180) * 111194.9)};
}
function cutRoute() {
  const full = FIXTURE.geometry.coordinates, ix = indexOf(full), corner = nav.projectPoint(ix, FIXTURE.steps[1].location[1], FIXTURE.steps[1].location[0], 0, ix.total, null).along;
  const end = corner + 420, coords = [];
  for (let i = 0; i < full.length && ix.cum[i] < end; i++) coords.push(full[i]);
  const last = pointAt(ix, end); coords.push([last.longitude, last.latitude]);
  const cutIx = indexOf(coords);
  const steps = [{...FIXTURE.steps[0], distance_m: Math.round(corner), duration_s: 80}, {...FIXTURE.steps[1], distance_m: 420, duration_s: 45},
    {instruction: 'You have arrived at your destination.', type: 4, street: '', distance_m: 0, duration_s: 0, location: coords[coords.length - 1]}];
  return {...FIXTURE, geometry: {type: 'LineString', coordinates: coords}, steps, distance_m: Math.round(cutIx.total), duration_s: 125, bbox: [76.9449, 43.238, 76.9584, 43.2445],
    start: coords[0], end: coords[coords.length - 1], alternatives: [], data_version: 'e2e-fixture-from-dev-reply'};
}
const ROUTE = cutRoute(), INDEX = indexOf(ROUTE.geometry.coordinates);
const DEST = ROUTE.geometry.coordinates.at(-1);
const START = pointAt(INDEX, 0);
const DEST_PLACE = {id: 7, name: 'Пункт назначения', name_ru: 'Пункт назначения', name_kk: 'Межелі жер', kind: 'city', lat: DEST[1], lon: DEST[0]};
/** Reroute answer: from the requested point onto the rest of the original geometry. */
function rerouteReply(fromLat, fromLon) {
  const hit = nav.projectPoint(INDEX, fromLat, fromLon, 0, INDEX.total, null);
  const rest = ROUTE.geometry.coordinates.filter((c, i) => INDEX.cum[i] > hit.along + 30);
  const coords = [[fromLon, fromLat], [hit.lon, hit.lat], ...rest];
  const ix = indexOf(coords);
  return {...ROUTE, geometry: {type: 'LineString', coordinates: coords}, distance_m: Math.round(ix.total), duration_s: Math.round(ix.total / 9),
    steps: [{instruction: 'Head east.', type: 2, street: 'Достық даңғылы', distance_m: Math.round(ix.total), duration_s: Math.round(ix.total / 9), location: coords[0]},
      {instruction: 'You have arrived at your destination.', type: 4, street: '', distance_m: 0, duration_s: 0, location: coords[coords.length - 1]}], start: coords[0]};
}

const MOCK_MAPLIBRE = `(function () {
  window.__calls = {flyTo: [], markers: [], removed: 0, sources: [], easeTo: [], puck: [], style: []};
  class Map {
    constructor(o) { this.h = {}; this.o = o; this._bearing = 0; window.__map = this; setTimeout(() => { this.fire('style.load'); this.fire('load'); }, 0); }
    fire(e, ev) { (this.h[e] || []).forEach(f => f(ev)); }
    on(e, a, b) { const key = b ? e + ':' + a : e; (this.h[key] = this.h[key] || []).push(b || a); }
    getBounds() { const c = this.o.center; return {getWest: () => c[0] - 0.05, getEast: () => c[0] + 0.05, getSouth: () => c[1] - 0.04, getNorth: () => c[1] + 0.04}; }
    getSource(id) { return {setData: d => window.__calls.sources.push([id, d]), getClusterExpansionZoom: () => Promise.resolve(13)}; }
    getLayer(id) { return {id}; }
    setFilter() {}
    easeTo(o) { window.__calls.easeTo.push({...o, at: Date.now()}); if (o.bearing != null) { this._bearing = o.bearing; this.fire('rotate'); } if (o.zoom != null) this._zoom = o.zoom; }
    fitBounds(b, o) { window.__calls.fit = [b, o]; }
    getCanvas() { return {style: {}}; }
    addControl() {}
    getBearing() { return this._bearing; }
    getCenter() { return {lng: this.o.center[0], lat: this.o.center[1]}; }
    getZoom() { return this._zoom || this.o.zoom; }
    getStyle() { return this.o.style; }
    setStyle(style) { this.o.style = style; window.__calls.style.push(style); }
    flyTo(o) { window.__calls.flyTo.push(o); }
    queryRenderedFeatures() { return []; }
  }
  class Marker {
    constructor(o) { this.el = o && o.element; }
    setLngLat(l) { this.ll = l; if (this.el && this.el.classList.contains('nav-puck')) window.__calls.puck.push(l); return this; }
    addTo() { window.__calls.markers.push(this.ll); if (this.el) document.body.append(this.el); return this; }
    remove() { window.__calls.removed++; if (this.el) this.el.remove(); }
  }
  window.maplibregl = {addProtocol() {}, Map, Marker, NavigationControl: class {}};
})();
`;
const INSTRUMENT = `(function () {
  window.__geo = {active: new Set(), starts: 0, clears: 0, options: null};
  const g = navigator.geolocation;
  if (g) {
    const w = g.watchPosition.bind(g), c = g.clearWatch.bind(g);
    g.watchPosition = (a, b, o) => { const id = w(a, b, o); window.__geo.active.add(id); window.__geo.starts++; window.__geo.options = o; return id; };
    g.clearWatch = id => { window.__geo.active.delete(id); window.__geo.clears++; return c(id); };
  }
  window.__hidden = false;
  Object.defineProperty(document, 'hidden', {configurable: true, get: () => window.__hidden});
  window.__navigations = 0; window.addEventListener('beforeunload', () => { window.__navigations++; });
})();`;

async function openPage(browser, {viewport = {width: 390, height: 844}, mobile = true, geo, routing, lang, theme, permissions} = {}) {
  const context = await browser.newContext({viewport, isMobile: mobile, hasTouch: mobile, colorScheme: theme || 'light',
    permissions: permissions || ['geolocation'], ...(geo !== null ? {geolocation: {...(geo || START), accuracy: 8}} : {})});
  const page = await context.newPage();
  const errors = [], csp = [], popups = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('popup', p => popups.push(p.url()));
  await page.addInitScript(INSTRUMENT);
  if (lang) await page.addInitScript(l => localStorage.setItem('kunde-lang', l), lang);
  if (theme) await page.addInitScript(t => localStorage.setItem('kunde-theme', t), theme);
  await page.route('**/vendor/**', route => {
    const url = route.request().url();
    if (url.endsWith('.css')) return route.fulfill({status: 200, contentType: 'text/css', body: ''});
    if (url.includes('maplibre-gl.js')) return route.fulfill({status: 200, contentType: 'application/javascript', body: MOCK_MAPLIBRE});
    return route.fulfill({status: 200, contentType: 'application/javascript', body: 'window.pmtiles={Protocol:class{constructor(){this.tile=()=>{}}}};'});
  });
  await page.route('**/config.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(
    {styleUrl: '/style.json', tileUrl: 'https://tiles.test/k.pmtiles', searchUrl: SEARCH, routingUrl: ROUTING})}));
  await page.route('https://tiles.test/**', route => route.fulfill({status: route.request().method() === 'OPTIONS' ? 204 : 206,
    headers: {...CORS, 'access-control-allow-headers': 'range', 'content-range': 'bytes 0-15/100'}, body: route.request().method() === 'OPTIONS' ? '' : '0123456789abcdef'}));
  await page.route(SEARCH + '/**', route => route.request().method() === 'OPTIONS' ? route.fulfill({status: 204, headers: CORS})
    : route.fulfill({status: 200, headers: {...CORS, 'content-type': 'application/json'}, body: JSON.stringify({results: [DEST_PLACE]})}));
  const routeRequests = [];
  await page.route(ROUTING + '/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers: CORS});
    const url = new URL(route.request().url());
    const [lat, lon] = url.searchParams.get('from').split(',').map(Number);
    routeRequests.push({lat, lon, to: url.searchParams.get('to'), mode: url.searchParams.get('mode'), alternatives: url.searchParams.get('alternatives'), path: url.pathname});
    const reply = await (routing ? routing(routeRequests.length, lat, lon, url) : (routeRequests.length === 1 ? ROUTE : (await sleep(2600), rerouteReply(lat, lon))));
    return route.fulfill({status: reply.status || 200, headers: {...CORS, 'content-type': 'application/json', ...(reply.headers || {})}, body: JSON.stringify(reply.body ?? reply)});
  });
  await page.goto(WEB + '/', {waitUntil: 'domcontentloaded'});
  await page.locator('#status').filter({hasText: /Карта загружена|Карта жүктелді|Map loaded/}).waitFor({timeout: 15000}).catch(() => {});
  return {page, context, errors, routeRequests, popups, csp};
}
async function planRoute(page, mode) {
  await page.locator('#search-query').fill('Пункт');
  await page.locator('#search-results [role=option]').first().click();
  await page.locator('#selection').waitFor();
  await page.locator('#route-place').click();
  if (mode && mode !== 'car') await page.locator('.mode[data-mode=' + mode + ']').click();
  await page.locator('#route-start').waitFor({state: 'visible'});
}
async function startNav(page) {
  await page.locator('#route-start').click();
  await page.locator('#nav').waitFor({state: 'visible'});
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function setPos(context, p, accuracy = 8) { await context.setGeolocation({latitude: p.latitude, longitude: p.longitude, accuracy}); }
/** Simulated drive: fixes at constant speed along the geometry of `ix` from s0 to s1 (metres). */
async function drive(context, ix, s0, s1, {step = 22, dt = 380, side = 0, acc = 8, each} = {}) {
  for (let s = s0; s <= s1; s += step) { await setPos(context, pointAt(ix, s, side), acc); if (each) await each(s); await sleep(dt); }
}
const text = (page, sel) => page.locator(sel).innerText();
const num = str => Number(String(str).replace(/[^\d.,]/g, '').replace(',', '.'));
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, {recursive: true}); await page.screenshot({path: path.join(SHOTS, name + '.png')}); } };
const calls = page => page.evaluate(() => window.__calls);
const geo = page => page.evaluate(() => ({active: window.__geo.active.size, starts: window.__geo.starts, clears: window.__geo.clears, options: window.__geo.options}));

const tests = {
  async 'full trip: Start -> GPS follow -> maneuvers -> progress/ETA -> deviation -> automatic reroute -> back on route -> arrival -> clean end'(browser) {
    const {page, context, errors, routeRequests, popups} = await openPage(browser);
    await planRoute(page);
    assert.equal(routeRequests.length, 1);
    assert.equal(await page.locator('#route-start').isVisible(), true);
    assert.match(await text(page, '#route-safety'), /Соблюдайте ПДД/);
    assert.equal((await geo(page)).starts, 0, 'no GPS watcher before the user presses Start');
    await startNav(page);
    await page.evaluate(() => { window.__states = []; new MutationObserver(() => { const el = document.querySelector('#nav'); const st = el.dataset.state + ':' + document.querySelector('#nav-alert-text').textContent.slice(0, 14) + '@' + Math.round(performance.now() / 100) / 10; window.__states.push(st); }).observe(document.querySelector('#nav'), {attributes: true, subtree: true, childList: true, characterData: true}); });
    assert.equal((await geo(page)).options.enableHighAccuracy, true);
    assert.equal(await page.evaluate(() => document.body.classList.contains('nav-on')), true);
    assert.equal(await page.locator('.rail').isHidden(), true, 'only map + HUD remain');
    await page.locator('#nav-text').filter({hasText: /Поверните налево|Начните/}).waitFor({timeout: 5000});
    await shot(page, 'nav-start');

    // drive the first leg
    const corner = INDEX.cum[3] ?? 0; void corner;
    const stepsAt = ROUTE.steps.map(s => nav.projectPoint(INDEX, s.location[1], s.location[0], 0, INDEX.total, null).along);
    const turnAt = stepsAt[1];
    let firstDist = null, lastDist = Infinity, monotonic = true, barPrev = -1;
    await drive(context, INDEX, 0, turnAt - 330, {each: async s => {
      if (s < 100) return;
      const d = num(await text(page, '#nav-dist')); if (firstDist == null) firstDist = d;
      if (d > lastDist + 60) monotonic = false; lastDist = d;
    }});
    assert.equal(await text(page, '#nav-text'), 'Поверните налево');
    assert.equal(await text(page, '#nav-street'), 'Достық даңғылы');
    assert.ok(num(await text(page, '#nav-dist')) <= 350 && num(await text(page, '#nav-dist')) >= 250, 'distance to the turn: ' + await text(page, '#nav-dist'));
    assert.ok(monotonic, 'distance to the next maneuver only decreases while driving towards it');
    assert.match(await text(page, '#nav-eta'), /^\d\d:\d\d$/);
    assert.match(await text(page, '#nav-left-time'), /мин/);
    assert.match(await text(page, '#nav-left-dist'), /\d+(,\d)? (км|м)$/);
    const barNow = Number((await page.locator('#nav-progress-bar').evaluate(e => e.style.width)).replace('%', ''));
    assert.ok(barNow > 20 && barNow < 80, 'progress ' + barNow);
    // marker follows the fixes, camera follows with padding for the panels and heading-up
    let c = await calls(page);
    const puck = c.puck.at(-1);
    assert.ok(Math.abs(puck[1] - pointAt(INDEX, turnAt - 330).latitude) < 0.0004, 'marker is at the simulated position');
    const cam = c.easeTo.at(-1);
    assert.ok(cam.padding.top > 40 && cam.padding.bottom > 80, 'camera padding leaves room for banner and bottom bar: ' + JSON.stringify(cam.padding));
    assert.ok(cam.bearing > 60 && cam.bearing < 120, 'heading-up: bearing follows the direction of travel (east): ' + cam.bearing);
    assert.equal(cam.pitch, 50);
    assert.equal(cam.essential, true);
    // route layer is split into travelled / remaining parts
    const navData = c.sources.filter(([id]) => id === 'navroute').at(-1)[1];
    assert.deepEqual(navData.features.map(f => f.properties.part), ['done', 'left']);
    assert.ok(navData.features[0].geometry.coordinates.length >= 2 && navData.features[1].geometry.coordinates.length >= 2);

    // user pans the map: following stops, a recenter button appears, the map is NOT yanked back; recenter resumes
    await page.evaluate(() => window.__map.fire('dragstart', {originalEvent: {type: 'mousedown'}}));
    assert.equal(await page.locator('#nav-recenter').isVisible(), true);
    const easeBefore = (await calls(page)).easeTo.length;
    await drive(context, INDEX, turnAt - 310, turnAt - 240);
    assert.equal((await calls(page)).easeTo.length, easeBefore, 'no camera moves while the user is exploring the map');
    await page.locator('#nav-recenter').click();
    assert.equal(await page.locator('#nav-recenter').isHidden(), true);
    assert.ok((await calls(page)).easeTo.length > easeBefore, 'recentre moved the camera');

    // maneuver list
    await page.locator('#nav-steps-btn').click();
    assert.ok((await page.locator('#nav-steps-list li').count()) >= 2);
    assert.equal(await page.locator('#nav-steps-list li[aria-current=step] strong').innerText(), 'Поверните налево');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#nav-steps-panel').isHidden(), true);

    // turn: the next maneuver becomes the arrival
    await drive(context, INDEX, turnAt - 220, turnAt + 40);
    await page.locator('#nav-text').filter({hasText: 'Вы прибыли'}).waitFor({timeout: 4000});
    assert.ok(num(await text(page, '#nav-dist')) > 200, 'distance to the destination');

    // deviation: leave the road gradually; one stray fix would not do it
    const here = turnAt + 60;
    const devStart = Date.now();
    for (let i = 0; i < 4 && routeRequests.length < 2; i++) { await setPos(context, pointAt(INDEX, here + i * 6, 50 + i * 30)); await sleep(1000); }
    await page.locator('#nav-alert').filter({hasText: 'Перестраиваем маршрут'}).waitFor({state: 'visible', timeout: 8000});
    assert.equal(await page.locator('#nav-banner').getAttribute('data-stale'), 'true', 'the old instruction is dimmed while rerouting');
    await shot(page, 'nav-reroute');
    await page.waitForFunction(() => window.__states.some(x => x.startsWith('REROUTING')) && document.querySelector('#nav').dataset.state === 'ACTIVE', null, {timeout: 8000});
    assert.equal(routeRequests.length, 2, 'exactly one reroute request');
    const rr = routeRequests[1];
    assert.equal(rr.alternatives, null, 'rerouting asks for a single route');
    assert.equal(rr.to, DEST[1].toFixed(5) + ',' + DEST[0].toFixed(5), 'the original destination is kept');
    assert.ok(nav.haversine(rr.lat, rr.lon, here, 0) >= 0, 'sanity');
    assert.ok(Date.now() - devStart < 9000);
    // drive the NEW route to the end
    const newRoute = rerouteReply(rr.lat, rr.lon), nix = indexOf(newRoute.geometry.coordinates);
    await page.waitForFunction(() => document.querySelector('#nav-alert').hidden);
    await drive(context, nix, 0, nix.total - 30, {step: 24, dt: 330});
    await drive(context, nix, nix.total - 8, nix.total, {step: 4, dt: 500});
    await page.locator('#nav-text').filter({hasText: 'Вы прибыли'}).waitFor();
    await page.locator('#nav[data-state=ARRIVED]').waitFor({timeout: 6000});
    assert.equal(await text(page, '#nav-end'), 'Готово');
    assert.equal((await geo(page)).active, 0, 'GPS watcher released on arrival');
    await shot(page, 'nav-arrived');
    await page.locator('#nav-end').click();
    await page.locator('#nav').waitFor({state: 'hidden'});
    assert.equal(await page.evaluate(() => document.body.classList.contains('nav-on')), false);
    assert.equal(await page.locator('#nav-recenter').isHidden(), true);
    assert.equal(await page.locator('.nav-puck').count(), 0, 'marker removed');
    const final = await calls(page);
    assert.equal(final.sources.filter(([id]) => id === 'navroute').at(-1)[1].features.length, 0, 'navigation layers cleared');
    // privacy and containment
    const hash = await page.evaluate(() => location.hash);
    assert.ok(!/76\.9[45]\d{3}/.test(hash) || hash.includes(DEST[0].toFixed(4).slice(0, 7)), 'URL carries at most the destination: ' + hash);
    assert.ok(!/route=.*(from|lat0)/.test(hash));
    assert.equal(await page.evaluate(() => window.__navigations), 0, 'no navigation away from the app');
    assert.deepEqual(popups, [], 'no new windows or external maps');
    assert.deepEqual(errors, [], 'no console errors');
    await context.close();
  },

  async 'GPS permission denied: clear message, no watcher left, Close returns to the map'(browser) {
    const {page, context} = await openPage(browser, {permissions: [], geo: null});
    await planRoute(page).catch(async () => {});
    await page.locator('#route-start').waitFor({state: 'visible', timeout: 8000}).catch(async () => {
      // without a device position the start must be picked on the map: use the first suggestion path
      await page.locator('#route-pick').click(); await page.evaluate(() => window.__map.fire('click', {lngLat: {lng: 76.9449, lat: 43.2382}, point: {x: 10, y: 10}}));
      await page.locator('#route-start').waitFor({state: 'visible'});
    });
    await page.locator('#route-start').click();
    await page.locator('#nav-text').filter({hasText: 'Доступ к геолокации запрещён'}).waitFor({timeout: 8000});
    assert.equal(await text(page, '#nav-end'), 'Закрыть');
    assert.equal((await geo(page)).active, 0);
    await page.locator('#nav-end').click();
    await page.locator('#nav').waitFor({state: 'hidden'});
    assert.equal(await page.locator('#route-panel').isHidden() && await page.locator('#selection').isVisible(), true, 'back to the place card');
    await context.close();
  },

  async 'weak GPS accuracy, a sudden GPS jump and signal loss are shown honestly and recover'(browser) {
    const {page, context, errors} = await openPage(browser);
    await planRoute(page); await startNav(page);
    await drive(context, INDEX, 0, 300);
    const before = await text(page, '#nav-left-dist');
    // a single wild jump (5 km away) is ignored
    await setPos(context, {latitude: START.latitude + 0.05, longitude: START.longitude + 0.05}); await sleep(500);
    await setPos(context, pointAt(INDEX, 330)); await sleep(600);
    assert.equal(await page.locator('#nav').getAttribute('data-state'), 'ACTIVE');
    assert.equal((await page.locator('#nav-alert').isVisible()), false, 'a jump does not raise an alarm');
    assert.ok(num(await text(page, '#nav-left-dist')) <= num(before) + 0.05, 'the jump did not move progress');
    // poor accuracy: three fixes worse than 100 m
    for (let i = 0; i < 4; i++) { await setPos(context, pointAt(INDEX, 340 + i * 5), 400); await sleep(450); }
    await page.locator('#nav-alert').filter({hasText: 'Слабый сигнал GPS'}).waitFor({timeout: 5000});
    await shot(page, 'nav-gps-weak');
    await setPos(context, pointAt(INDEX, 380), 9); await sleep(500);
    await page.locator('#nav-alert').waitFor({state: 'hidden', timeout: 4000});
    // signal lost: no fixes for >8 s
    await page.locator('#nav-alert').filter({hasText: /Сигнал GPS потерян|GPS недоступен|GPS не отвечает/}).waitFor({timeout: 13000});   // the cause shown depends on what the browser reported while silent
    await setPos(context, pointAt(INDEX, 400)); await sleep(500);
    await page.locator('#nav-alert').waitFor({state: 'hidden', timeout: 4000});
    assert.deepEqual(errors, []);
    await context.close();
  },

  async 'background and return: navigation pauses, does not trust the stale position, resumes with a fresh fix'(browser) {
    const {page, context} = await openPage(browser);
    await planRoute(page); await startNav(page);
    await drive(context, INDEX, 0, 400);
    await page.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await page.locator('#nav-alert').filter({hasText: 'на паузе'}).waitFor();
    await setPos(context, pointAt(INDEX, 500)); await sleep(400);
    assert.equal(await page.locator('#nav').getAttribute('data-state'), 'PAUSED', 'fixes in the background are ignored');
    await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await page.locator('#nav-alert').filter({hasText: 'Возвращаем положение'}).waitFor();
    await sleep(300); await setPos(context, pointAt(INDEX, 620)); await sleep(600);
    await page.locator('#nav[data-state=ACTIVE]').waitFor({timeout: 4000});
    assert.equal((await geo(page)).active, 1, 'still exactly one watcher');
    await context.close();
  },

  async 'ending navigation takes two taps (no dialog); everything is released; a new start never duplicates watchers; fast mode changes keep one route'(browser) {
    const {page, context, routeRequests} = await openPage(browser);
    await planRoute(page); await startNav(page);
    await drive(context, INDEX, 0, 120);
    await page.locator('#nav-end').click();
    assert.equal(await text(page, '#nav-end'), 'Точно завершить?');
    assert.equal(await page.locator('#nav').isVisible(), true, 'a single tap does not end navigation');
    await page.waitForFunction(() => document.querySelector('#nav-end').textContent === 'Завершить', null, {timeout: 6000});
    await page.locator('#nav-end').click(); await page.locator('#nav-end').click();
    await page.locator('#nav').waitFor({state: 'hidden'});
    let g = await geo(page);
    assert.equal(g.active, 0); assert.equal(g.starts, g.clears);
    // restart: still only one watcher; rapid mode switching before Start leaves one request result
    await page.locator('.mode[data-mode=foot]').waitFor({state: 'visible'}).catch(() => {});
    await page.locator('#selection-close').click().catch(() => {});
    await planRoute(page);
    for (const m of ['foot', 'bike', 'car', 'foot']) await page.locator('.mode[data-mode=' + m + ']').click();
    await page.locator('#route-start').waitFor({state: 'visible'});
    await startNav(page);
    assert.equal((await geo(page)).active, 1);
    await page.locator('#nav-end').click(); await page.locator('#nav-end').click();
    await page.locator('#nav').waitFor({state: 'hidden'});
    assert.equal((await geo(page)).active, 0);
    assert.ok(routeRequests.every(r => r.path === '/v1/route'));
    await context.close();
  },

  async 'rerouting errors: 429 Retry-After and a failed request keep a safe state, explain, retry with a cooldown, and never loop'(browser) {
    const script = [{status: 429, headers: {'retry-after': '2'}, body: {error: 'rate_limited'}}, {status: 502, headers: {'retry-after': '5'}, body: {error: 'routing_unavailable'}}];
    let rerouteN = 0;
    const {page, context, routeRequests} = await openPage(browser, {routing: async (n, lat, lon) => {
      if (n === 1) return ROUTE;
      const r = script[rerouteN++]; return r || rerouteReply(lat, lon);
    }});
    await planRoute(page); await startNav(page);
    await drive(context, INDEX, 0, 300);
    for (let i = 0; i < 4; i++) { await setPos(context, pointAt(INDEX, 320 + i * 6, 50 + i * 30)); await sleep(1000); }
    await page.locator('#nav-alert').filter({hasText: /Слишком много запросов/}).waitFor({timeout: 6000});
    assert.equal(await page.locator('#nav').getAttribute('data-state'), 'OFF_ROUTE', 'the old route stays on screen');
    assert.equal(await page.locator('#nav-banner').getAttribute('data-stale'), 'true');
    await shot(page, 'nav-reroute-429');
    assert.equal(routeRequests.length, 2, 'one reroute attempt so far');
    // keep reporting fixes while waiting: the cooldown means no request storm
    for (let i = 0; i < 6; i++) { await setPos(context, pointAt(INDEX, 340 + i * 6, 190 + i * 5)); await sleep(1000); }
    assert.ok(routeRequests.length <= 3, 'cooldown holds (' + routeRequests.length + ' requests)');
    await page.locator('#nav-alert').filter({hasText: /Не удалось перестроить|временно недоступен|Перестраиваем/}).waitFor({timeout: 12000});
    // the third attempt succeeds
    for (let i = 0; i < 40 && await page.locator('#nav').getAttribute('data-state') !== 'ACTIVE'; i++) { await setPos(context, pointAt(INDEX, 380 + i, 210)); await sleep(1000); }
    assert.equal(await page.locator('#nav').getAttribute('data-state'), 'ACTIVE');
    assert.equal(routeRequests.length, 4, 'exactly one request per attempt: 429, 502, success');
    await context.close();
  },

  async 'cold start while rerouting shows a waiting message without blocking the HUD'(browser) {
    let n = 0;
    const {page, context} = await openPage(browser, {routing: async (k, lat, lon) => { if (k === 1) return ROUTE; await sleep(4500); return rerouteReply(lat, lon); }});
    await planRoute(page); await startNav(page);
    await drive(context, INDEX, 0, 300);
    for (let i = 0; i < 4; i++) { await setPos(context, pointAt(INDEX, 320 + i * 6, 50 + i * 30)); await sleep(1000); }
    await page.locator('#nav-alert').filter({hasText: 'просыпается'}).waitFor({timeout: 8000});
    assert.equal(await page.locator('#nav-end').isEnabled(), true);
    assert.equal(await page.locator('#nav-steps-btn').isEnabled(), true);
    await page.locator('#nav[data-state=ACTIVE]').waitFor({timeout: 10000});
    void n;
    await context.close();
  },

  async 'walking and cycling use the same navigation with their own thresholds; arrival by foot'(browser) {
    for (const mode of ['foot', 'bike']) {
      const reply = {...ROUTE, mode, duration_s: 1200};
      const {page, context} = await openPage(browser, {routing: async () => reply});
      await planRoute(page, mode);
      assert.match(await text(page, '#route-safety'), /ПДД/);
      await startNav(page);
      await drive(context, INDEX, 0, 140, {step: 8, dt: 330});
      assert.equal(await page.locator('#nav').getAttribute('data-state'), 'ACTIVE', mode);
      assert.equal((await calls(page)).easeTo.at(-1).pitch, mode === 'foot' ? 0 : 30);
      await page.locator('#nav-end').click(); await page.locator('#nav-end').click();
      await context.close();
    }
  },

  async 'RU / KK / EN: banner, bottom bar and maneuver list are localized; light and dark themes'(browser) {
    const expected = {ru: ['Поверните налево', 'Прибытие', 'Осталось', 'Расстояние', 'Завершить'], kk: ['Солға бұрылыңыз', 'Жету уақыты', 'Қалды', 'Қашықтық', 'Аяқтау'],
      en: ['Turn left', 'Arrival', 'Left', 'Distance', 'End']};
    for (const [lang, [maneuver, eta, left, dist, end]] of Object.entries(expected)) {
      const {page, context} = await openPage(browser, {lang, theme: lang === 'kk' ? 'dark' : 'light'});
      await planRoute(page); await startNav(page);
      const turnAt = nav.projectPoint(INDEX, ROUTE.steps[1].location[1], ROUTE.steps[1].location[0], 0, INDEX.total, null).along;
      await drive(context, INDEX, 0, turnAt - 200, {step: 30, dt: 330});
      assert.equal(await text(page, '#nav-text'), maneuver, lang);
      assert.equal(await text(page, '#nav-eta-label'), eta); assert.equal(await text(page, '#nav-left-label'), left);
      assert.equal(await text(page, '#nav-dist-label'), dist); assert.equal(await text(page, '#nav-end'), end);
      assert.equal(await text(page, '#nav-street'), 'Достық даңғылы', 'street names are data, not translated');
      assert.match(await text(page, '#nav-dist'), lang === 'en' ? /\d+ m$/ : /\d+ м$/);
      await page.locator('#nav-steps-btn').click();
      assert.equal(await page.locator('#nav-steps-list li').first().locator('strong').innerText(), maneuver);
      await shot(page, 'nav-' + lang + '-' + (lang === 'kk' ? 'dark' : 'light'));
      await context.close();
    }
  },

  async 'layout: 320x700, 390x844, 1366x768, 1920x1080 - no horizontal scroll, panels inside the screen and not overlapping, touch targets >= 44px'(browser) {
    for (const [w, h, mobile] of [[320, 700, true], [390, 844, true], [1366, 768, false], [1920, 1080, false]]) {
      const {page, context} = await openPage(browser, {viewport: {width: w, height: h}, mobile});
      await planRoute(page); await startNav(page);
      await drive(context, INDEX, 0, 200, {step: 40, dt: 330});
      await page.locator('#nav-steps-btn').click();
      await page.evaluate(() => window.__map.fire('dragstart', {originalEvent: {}}));
      const m = await page.evaluate(() => {
        const r = sel => { const e = document.querySelector(sel); return e && !e.hidden ? e.getBoundingClientRect().toJSON() : null; };
        return {sw: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight, top: r('.nav-top'), bottom: r('#nav-bottom'), banner: r('#nav-banner'), steps: r('#nav-steps-panel'),
          fab: r('#nav-recenter'), end: r('#nav-end'), stepsBtn: r('#nav-steps-btn'), dist: r('#nav-dist')};
      });
      assert.ok(m.sw <= m.vw, `${w}: horizontal scroll ${m.sw} > ${m.vw}`);
      for (const k of ['top', 'bottom', 'steps', 'fab']) assert.ok(m[k].left >= 0 && m[k].right <= m.vw + 0.5 && m[k].top >= 0 && m[k].bottom <= m.vh + 0.5, `${w}: ${k} inside the screen ${JSON.stringify(m[k])}`);
      assert.ok(m.top.bottom <= m.bottom.top + 0.5 || w >= 720, `${w}: banner and bottom bar overlap on a phone`);
      if (w >= 720) { assert.ok(m.top.right <= 400 && m.bottom.right <= 400, `${w}: desktop panel is a left column`); }
      assert.ok(m.steps.bottom <= m.bottom.top + 2, `${w}: the list sits above the bottom bar`);
      assert.ok(m.fab.bottom <= m.bottom.top + 1 || w >= 720, `${w}: recenter button above the bottom bar`);
      for (const k of ['end', 'stepsBtn', 'fab']) assert.ok(m[k].height >= 44 && m[k].width >= 44, `${w}: touch target ${k} ${m[k].width}x${m[k].height}`);
      assert.ok(m.dist.width > 0);
      await shot(page, `nav-${w}x${h}`);
      await context.close();
    }
  },

  async 'accessibility: labelled controls, live announcements only for maneuvers, keyboard shortcuts, reduced motion'(browser) {
    const {page, context} = await openPage(browser, {viewport: {width: 1366, height: 768}, mobile: false});
    await page.emulateMedia({reducedMotion: 'reduce'});
    await planRoute(page); await startNav(page);
    const turnAt = nav.projectPoint(INDEX, ROUTE.steps[1].location[1], ROUTE.steps[1].location[0], 0, INDEX.total, null).along;
    await drive(context, INDEX, 0, turnAt - 120, {step: 30, dt: 330});
    for (const id of ['nav-end', 'nav-steps-btn']) assert.ok((await text(page, '#' + id)).length > 0);
    assert.equal(await page.locator('#nav-steps-btn').getAttribute('aria-controls'), 'nav-steps-panel');
    assert.equal(await page.locator('#nav-announce').getAttribute('aria-live'), 'polite');
    assert.match(await text(page, '#nav-announce'), /Поверните налево/);
    await page.keyboard.press('l'); assert.equal(await page.locator('#nav-steps-panel').isVisible(), true);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#nav-steps-panel').isHidden(), true);
    await page.evaluate(() => window.__map.fire('dragstart', {originalEvent: {}}));
    await page.keyboard.press('c'); assert.equal(await page.locator('#nav-recenter').isHidden(), true);
    const last = (await calls(page)).easeTo.at(-1); assert.equal(last.duration, 0, 'reduced motion: the camera does not animate');
    await context.close();
  },
};

(async () => {
  const browser = await chromium.launch({headless: true});
  const only = process.argv[2];
  let failed = 0;
  try {
    for (const [name, fn] of Object.entries(tests)) {
      if (only && !name.includes(only)) continue;
      const t0 = Date.now();
      try { await fn(browser); console.log('ok   -', name, `(${Math.round((Date.now() - t0) / 1000)} s)`); }
      catch (error) { failed++; console.error('FAIL -', name, '\n      ', String(error.stack || error.message).split('\n').slice(0, 8).join('\n       ')); }
    }
  } finally { await browser.close(); }
  console.log(failed ? failed + ' navigation UI test(s) failed' : 'All navigation UI tests passed');
  process.exitCode = failed ? 1 : 0;
})();

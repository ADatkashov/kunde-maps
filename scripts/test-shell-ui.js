/* Browser test of the Phase 5.5 app shell: bottom sheet gestures, tab bar, quick categories, profile, layers, dialogs, locate states,
 * layouts (mobile sizes + desktop), accessibility smoke. Chromium against the real static page with a MOCKED MapLibre and scripted APIs:
 * deterministic, but it is NOT an end-to-end test of the real map or backend (see scripts/test-redesign-live.js for that).
 * Usage: WEB_URL=http://127.0.0.1:18081 node scripts/test-shell-ui.js   (requires playwright) */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const WEB = process.env.WEB_URL || 'http://127.0.0.1:18080';
const SEARCH = 'https://search.test';
const CORS = {'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range,Content-Length,Retry-After'};
const poi = (id, name, category, lat, lon, extra = {}) => ({id, name, name_ru: null, name_kk: null, name_en: null, category, subtype: category, lat, lon,
  address: null, phone: null, website: null, hours: null, brand: null, ...extra});
const PHARMACY = poi('n11', 'Аптека Бета', 'pharmacy', 43.241, 76.951, {distance_m: 120, address: 'Абая 5'});
const ALMATY = {id: 1, name: 'Алматы', name_ru: 'Алматы', name_kk: 'Алматы', kind: 'city', lat: 43.2364, lon: 76.9457};

const MOCK_MAPLIBRE = `(function () {
  window.__calls = {flyTo: [], markers: [], styles: [], sources: [], easeTo: [], zoom: 0};
  class Map {
    constructor(o) { this.h = {}; this.o = o; window.__map = this; setTimeout(() => { this.fire('style.load'); this.fire('load'); }, 0); }
    fire(e, ev) { (this.h[e] || []).forEach(f => f(ev)); }
    on(e, a, b) { const key = b ? e + ':' + a : e; (this.h[key] = this.h[key] || []).push(b || a); }
    getBounds() { const c = this.o.center; return {getWest: () => c[0] - 0.05, getEast: () => c[0] + 0.05, getSouth: () => c[1] - 0.04, getNorth: () => c[1] + 0.04}; }
    getSource() { return {setData: d => window.__calls.sources.push(d), getClusterExpansionZoom: () => Promise.resolve(13)}; }
    getLayer(id) { return {id}; } setFilter() {} fitBounds() {} getCanvas() { return {style: {}}; } addControl() {}
    easeTo(o) { window.__calls.easeTo.push(o); } flyTo(o) { window.__calls.flyTo.push(o); }
    getCenter() { return {lng: this.o.center[0], lat: this.o.center[1]}; } getZoom() { return 14; } getBearing() { return window.__bearing || 0; }
    getStyle() { return this.o.style; } setStyle(style, options) { window.__calls.styles.push({style, options}); this.o.style = style; }
    zoomIn() { window.__calls.zoom++; } zoomOut() { window.__calls.zoom--; } resetNorth() { window.__calls.north = true; window.__bearing = 0; this.fire('rotate'); }
    queryRenderedFeatures() { return []; }
  }
  class Marker { constructor(o) { this.el = o && o.element; } setLngLat(l) { this.ll = l; return this; } addTo() { window.__calls.markers.push(this.ll); if (this.el) document.body.append(this.el); return this; } remove() { if (this.el) this.el.remove(); } }
  window.maplibregl = {addProtocol() {}, Map, Marker, NavigationControl: class {}};
})();`;

async function openPage(browser, {viewport = {width: 390, height: 844}, mobile = true, colorScheme = 'dark', geo, geoDenied = false, storage, places, reducedMotion = false, hash = '', waitLoaded = true,
  initScript, lowEnd = false} = {}) {
  const context = await browser.newContext({viewport, colorScheme, isMobile: mobile, hasTouch: mobile, reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    ...(geo ? {permissions: ['geolocation'], geolocation: geo} : {})});
  const page = await context.newPage();
  const errors = [], placeRequests = [], searchRequests = [], blocked = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  if (storage) await page.addInitScript(entries => { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); }, storage);
  if (lowEnd) await page.addInitScript(() => { Object.defineProperty(navigator, 'deviceMemory', {value: 1}); });
  if (initScript) await page.addInitScript(initScript);
  await page.route('**/vendor/**', route => {
    const url = route.request().url();
    if (url.endsWith('.css')) return route.fulfill({status: 200, contentType: 'text/css', body: ''});
    if (url.includes('maplibre-gl.js')) return route.fulfill({status: 200, contentType: 'application/javascript', body: MOCK_MAPLIBRE});
    return route.fulfill({status: 200, contentType: 'application/javascript', body: 'window.pmtiles={Protocol:class{constructor(){this.tile=()=>{}}}};'});
  });
  await page.route('**/config.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(
    {styleUrl: '/style.json', tileUrl: 'https://tiles.test/k.pmtiles', searchUrl: SEARCH, routingUrl: 'https://route.test'})}));
  await page.route('https://tiles.test/**', route => route.fulfill({status: route.request().method() === 'OPTIONS' ? 204 : 206,
    headers: {...CORS, 'access-control-allow-headers': 'range', 'content-range': 'bytes 0-15/100'}, body: route.request().method() === 'OPTIONS' ? '' : '0123456789abcdef'}));
  await page.route('https://route.test/**', route => { blocked.push(route.request().url()); route.fulfill({status: 204, headers: CORS}); });
  await page.route(SEARCH + '/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers: CORS});
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/v1/places')) {
      placeRequests.push(url.pathname + url.search);
      const body = places ? await places(url) : {places: [PHARMACY], truncated: false};
      return route.fulfill({status: 200, headers: {...CORS, 'content-type': 'application/json'}, body: JSON.stringify(body)});
    }
    searchRequests.push(url.searchParams.get('q'));
    return route.fulfill({status: 200, headers: {...CORS, 'content-type': 'application/json'}, body: JSON.stringify({results: [ALMATY]})});
  });
  await page.goto(WEB + '/' + hash, {waitUntil: 'domcontentloaded'});
  if (waitLoaded) await page.locator('#status').filter({hasText: 'Карта загружена'}).waitFor({timeout: 15000});
  return {page, context, errors, placeRequests, searchRequests, blocked};
}
const box = (page, sel) => page.locator(sel).evaluate(el => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right}; });
const snap = page => page.locator('#sheet').getAttribute('data-snap');

const SIZES = [[320, 700], [360, 800], [390, 844], [412, 915], [430, 932]];
const tests = {
  async 'home: full-screen map, compact top bar, collapsed sheet with four real quick actions, tab bar, no overflow at five phone sizes'(browser) {
    for (const [w, h] of SIZES) {
      const {page, context, errors} = await openPage(browser, {viewport: {width: w, height: h}});
      const m = await page.evaluate(() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, map: document.getElementById('map').getBoundingClientRect().toJSON()}));
      assert.equal(m.sw, m.cw, `no horizontal scroll at ${w}`);
      assert.deepEqual([m.map.width, m.map.height], [w, h], 'the map fills the whole screen');
      assert.equal(await snap(page), 'collapsed');
      const sheet = await box(page, '#sheet'), tab = await box(page, '#tabbar');
      assert.ok(Math.abs(sheet.b - tab.y) <= 1, `sheet sits right on the tab bar (${sheet.b} vs ${tab.y})`);
      assert.ok(sheet.h < h * 0.25, 'collapsed sheet leaves most of the map visible: ' + sheet.h);
      assert.equal(await page.locator('#quick-actions .qa').count(), 4);
      assert.equal(await page.locator('#search-query').getAttribute('placeholder'), 'Поиск мест, адресов, маршрутов');
      const small = await page.evaluate(() => [...document.querySelectorAll('button, input, a.btn')].filter(e => e.offsetParent && !e.closest('[hidden]') && e.getBoundingClientRect().height > 0 &&
        (e.getBoundingClientRect().height < 43.5 || (e.tagName !== 'INPUT' && e.getBoundingClientRect().width < 43.5))).map(e => [e.id || e.className, Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]));
      assert.deepEqual(small.filter(([n]) => n !== 'sheet-handle'), [], `touch targets >= 44px at ${w}`);
      // the OSM attribution zone (bottom of the map, above the sheet) is never covered: --sheet-h equals the area the sheet and tab bar occupy
      const covered = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-h')));
      assert.ok(Math.abs(covered - (h - sheet.y)) <= 1.5, `--sheet-h ${covered} vs ${h - sheet.y}`);
      assert.deepEqual(errors, []);
      await context.close();
    }
  },
  async 'bottom sheet: drag up/down between collapsed, half and full; keyboard; aria state'(browser) {
    const {page, context, errors} = await openPage(browser);
    const handle = await box(page, '#sheet-handle');
    const cx = handle.x + handle.w / 2, cy = handle.y + handle.h / 2;
    const heights = {};
    heights.collapsed = (await box(page, '#sheet')).h;
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(cx, cy - i * 30, {steps: 2}); await page.waitForTimeout(110); }   // slow drag (no flick), ends near the half snap
    await page.mouse.up();
    await page.waitForTimeout(450);
    assert.equal(await snap(page), 'half', 'slow drag of ~240 px settles on the nearest snap (half)');
    heights.half = (await box(page, '#sheet')).h;
    assert.ok(heights.half > heights.collapsed + 60);
    assert.equal(await page.locator('#sheet-handle').getAttribute('aria-expanded'), 'true');
    const hb = await box(page, '#sheet-handle');
    await page.mouse.move(hb.x + hb.w / 2, hb.y + 10); await page.mouse.down();
    await page.mouse.move(hb.x + hb.w / 2, hb.y - 400, {steps: 4}); await page.mouse.up();
    await page.waitForTimeout(450);
    assert.equal(await snap(page), 'full');
    heights.full = (await box(page, '#sheet')).h;
    const top = await page.evaluate(() => document.getElementById('topbar').getBoundingClientRect().bottom);
    assert.ok((await box(page, '#sheet')).y >= top - 1, 'the full sheet never covers the search field and the categories');
    assert.ok(heights.full > heights.half);
    assert.equal(await page.locator('#map-tools').isVisible(), false, 'map tools give way to the full sheet');
    const hb2 = await box(page, '#sheet-handle');
    await page.mouse.move(hb2.x + hb2.w / 2, hb2.y + 10); await page.mouse.down();
    await page.mouse.move(hb2.x + hb2.w / 2, hb2.y + 700, {steps: 4}); await page.mouse.up();
    await page.waitForTimeout(450);
    assert.equal(await snap(page), 'collapsed', 'a long drag down collapses the sheet');
    assert.equal(await page.locator('#sheet-handle').getAttribute('aria-expanded'), 'false');
    // keyboard
    await page.locator('#sheet-handle').focus();
    await page.keyboard.press('ArrowUp'); assert.equal(await snap(page), 'half');
    await page.keyboard.press('ArrowUp'); assert.equal(await snap(page), 'full');
    await page.keyboard.press('ArrowDown'); assert.equal(await snap(page), 'half');
    await page.keyboard.press('Home'); assert.equal(await snap(page), 'collapsed');
    await page.keyboard.press('End'); assert.equal(await snap(page), 'full');
    await page.keyboard.press('Enter'); assert.equal(await snap(page), 'collapsed', 'Enter cycles');
    assert.match(await page.locator('#sheet-handle').getAttribute('aria-label'), /свёрнута/);
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'bottom sheet: a tap on the grip toggles, and drags on the grip never move the map'(browser) {
    const {page, context} = await openPage(browser);
    const mapMoves = await page.evaluate(() => { window.__mapEvents = 0; window.__map.on('move', () => window.__mapEvents++); return true; });
    const h = await box(page, '#sheet-handle');
    await page.mouse.click(h.x + h.w / 2, h.y + h.h / 2);
    await page.waitForTimeout(400);
    assert.equal(await snap(page), 'half');
    await page.mouse.click(h.x + 50, (await box(page, '#sheet-handle')).y + 12);
    await page.waitForTimeout(400);
    assert.equal(await snap(page), 'full');
    assert.equal(await page.evaluate(() => window.__mapEvents), 0, 'sheet gestures do not reach the map');
    await context.close();
  },
  async 'tab bar: five tabs, one current, keyboard arrows, each opens its screen; Directions asks for nothing and does not start GPS'(browser) {
    const {page, context, errors, blocked} = await openPage(browser);
    const names = await page.locator('#tabbar .tab').allInnerTexts();
    assert.deepEqual(names.map(t => t.trim()), ['Поиск', 'Проезд', 'Навигатор', 'Избранное', 'Профиль']);
    const current = () => page.locator('#tabbar .tab[aria-current="page"]').allInnerTexts().then(a => a.map(t => t.trim()));
    assert.deepEqual(await current(), ['Поиск']);
    await page.locator('#tabbar .tab[data-tab=route]').click();
    assert.equal(await page.locator('#route-panel').isVisible(), true);
    assert.deepEqual(await current(), ['Проезд']);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'route-to', 'the destination field is focused');
    assert.match(await page.locator('#route-state').innerText(), /куда едем/i);
    assert.equal(blocked.length, 0, 'no routing request without two points');
    await page.locator('#tabbar .tab[data-tab=navigator]').click();
    assert.equal(await page.locator('#navigator-panel').isVisible(), true);
    assert.deepEqual(await current(), ['Навигатор']);
    assert.match(await page.locator('#navigator-head').innerText(), /Маршрут ещё не выбран/);
    assert.match(await page.locator('#navigator-hint').innerText(), /GPS включается только после/);
    await page.locator('#navigator-action').click();
    assert.equal(await page.locator('#route-panel').isVisible(), true, '"Build a route" opens Directions');
    await page.locator('#tabbar .tab[data-tab=favorites]').click();
    assert.equal(await page.locator('#favorites-panel').isVisible(), true);
    assert.equal(await page.locator('#route-panel').isHidden(), true);
    assert.deepEqual(await current(), ['Избранное']);
    assert.match(await page.locator('#favorites-note').innerText(), /только на этом устройстве|на устройстве/i);
    await page.locator('#tabbar .tab[data-tab=profile]').click();
    assert.equal(await page.locator('#profile-panel').isVisible(), true);
    assert.match(await page.locator('#profile-note').innerText(), /Аккаунтов в KUNDE Maps пока нет/);
    await page.locator('#tabbar .tab[data-tab=search]').click();
    assert.equal(await page.locator('#home-panel').isVisible(), true);
    // keyboard: roving with arrows, activation with Enter/Space
    await page.locator('#tabbar .tab[data-tab=search]').focus();
    await page.keyboard.press('ArrowRight'); assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'route');
    await page.keyboard.press('End'); assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'profile');
    await page.keyboard.press('ArrowRight'); assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'search', 'wraps around');
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#profile-panel').isVisible(), true);
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'quick categories: real nearby request around the device position (rounded), viewport fallback without it, "More" lists the rest'(browser) {
    const geo = {latitude: 43.2389123, longitude: 76.9456789};
    {
      const {page, context, placeRequests, errors} = await openPage(browser, {geo});
      assert.deepEqual(await page.locator('#quick-cats .qcat:not(.more)').evaluateAll(els => els.map(e => e.dataset.category)), ['shop', 'restaurant', 'hotel', 'pharmacy', 'fuel']);
      assert.equal(placeRequests.length, 0, 'nothing is requested (and GPS is not asked) before the user taps');
      await page.locator('#quick-cats .qcat[data-category=pharmacy]').click();
      await page.locator('#places-list .row').first().waitFor();
      assert.match(placeRequests[0], /^\/v1\/places\?lat=43\.239&lon=76\.946&radius=1500&limit=\d+&category=pharmacy/);
      assert.match(await page.locator('#places-list').innerText(), /Аптека Бета/);
      assert.equal(await page.locator('#home-panel').isHidden(), true, 'results replace the home panel');
      assert.equal(await page.locator('#chips .chip[data-category=pharmacy]').getAttribute('aria-pressed'), 'true');
      await page.locator('#places-clear').click();
      assert.equal(await page.locator('#home-panel').isVisible(), true);
      await page.locator('#qcat-more').click();
      const cats = await page.locator('#quick-cats .qcat:not(.more)').evaluateAll(els => els.map(e => e.dataset.category));
      for (const c of ['hospital', 'school', 'parking', 'bank', 'park']) assert.ok(cats.includes(c), c);
      assert.equal(await page.locator('#qcat-more').getAttribute('aria-expanded'), 'true');
      assert.deepEqual(errors, []);
      await context.close();
    }
    {
      const {page, context, placeRequests} = await openPage(browser);   // geolocation not granted
      await page.locator('#quick-cats .qcat[data-category=fuel]').click();
      await page.locator('#locate[data-state="denied"], #locate[data-state="error"]').waitFor();
      await page.waitForFunction(() => document.querySelector('#places-panel:not([hidden])'));
      assert.match(placeRequests[0], /^\/v1\/places\?bbox=/, 'falls back to the visible map area, never invents a position');
      assert.match(placeRequests[0], /category=fuel/);
      await context.close();
    }
  },
  async 'category chips: the requested order, real Places categories, More reveals the rest, hotels and banks are honestly named'(browser) {
    const {page, context, placeRequests} = await openPage(browser);
    const order = await page.locator('#chips .chip:not([hidden])').evaluateAll(els => els.map(e => e.dataset.category || e.id));
    assert.deepEqual(order, ['chip-near', 'restaurant', 'cafe', 'shop', 'pharmacy', 'fuel', 'hotel', 'parking', 'bank', 'chip-more']);
    const text = await page.locator('#chips').innerText();
    assert.match(text, /Отели/); assert.match(text, /Парковки/); assert.match(text, /Банки и банкоматы/);
    await page.locator('#chip-more').click();
    assert.ok(await page.locator('#chips .chip[data-category=school]').isVisible() || (await page.locator('#chips .chip.extra:not([hidden])').count()) >= 8);
    assert.equal(await page.locator('#chip-more').getAttribute('aria-expanded'), 'true');
    await page.locator('#chips .chip[data-category=bank]').click();
    await page.locator('#places-list .row').first().waitFor();
    assert.match(placeRequests.at(-1), /category=bank/);
    await context.close();
  },
  async 'place card: title, category, distance, address and the three real actions; no empty rows'(browser) {
    const {page, context} = await openPage(browser, {geo: {latitude: 43.2389, longitude: 76.9457}});
    await page.locator('#quick-cats .qcat[data-category=pharmacy]').click();
    await page.locator('#places-list .row').first().click();
    await page.locator('#selection').waitFor();
    assert.equal(await page.locator('#selection-title').innerText(), 'Аптека Бета');
    assert.equal(await page.locator('#selection-chip').isVisible(), true);
    const details = await page.locator('#selection-details').innerText();
    assert.match(details, /120 м/); assert.match(details, /Абая 5/);
    assert.equal(await page.locator('#selection-details > div').count(), 2, 'only the fields that exist');
    assert.equal(await page.locator('#selection-hours').isHidden(), true);
    assert.equal(await page.locator('#selection-open').isHidden(), true);
    assert.deepEqual((await page.locator('.place-actions .btn:visible').allInnerTexts()).map(t => t.trim()).slice(0, 3), ['Маршрут', 'Сохранить', 'Поделиться']);
    assert.equal(await snap(page), 'half', 'a card opens the sheet half way');
    await context.close();
  },
  async 'search history: kept on the device, shown on Home, re-runs a search, can be switched off and clears itself'(browser) {
    const {page, context, searchRequests} = await openPage(browser);
    assert.equal(await page.locator('#recent').isHidden(), true, 'no history -> no section');
    await page.locator('#search-query').fill('Алматы');
    await page.locator('#search-results [role=option]').first().click();
    await page.locator('#selection-close').click();
    await page.locator('#search-clear').click();
    assert.equal(await page.locator('#recent').isVisible(), true);
    assert.equal(await page.locator('#recent-list .row').first().innerText(), 'Алматы');
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('kunde-history'))), ['Алматы']);
    await page.locator('#recent-list .row').first().click();
    await page.locator('#search-results [role=option]').first().waitFor();
    assert.equal(await page.locator('#search-query').inputValue(), 'Алматы', 'tapping a recent query fills the field and searches');
    await page.locator('#tabbar .tab[data-tab=profile]').click();
    await page.locator('#set-history').click();
    assert.equal(await page.locator('#set-history').getAttribute('aria-checked'), 'false');
    assert.equal(await page.evaluate(() => localStorage.getItem('kunde-history')), null, 'turning history off deletes it');
    await page.locator('#tabbar .tab[data-tab=search]').click();
    assert.equal(await page.locator('#recent').isHidden(), true);
    await context.close();
  },
  async 'profile: language, theme (system/light/dark), units, low-power, privacy text, clear data with a confirmation dialog'(browser) {
    const {page, context, errors} = await openPage(browser, {storage: {'kunde-favorites': JSON.stringify([{id: 'n10', name: 'Кофейня', category: 'cafe', subtype: 'cafe', lat: 43.24, lon: 76.95, address: null}])}});
    await page.locator('#tabbar .tab[data-tab=profile]').click();
    assert.equal(await page.locator('#set-language .seg').count(), 3);
    await page.locator('#set-language .seg[data-value=en]').click();
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await page.locator('#profile-title').innerText(), 'Profile');
    assert.deepEqual((await page.locator('#tabbar .tab').allInnerTexts()).map(t => t.trim()), ['Search', 'Directions', 'Navigator', 'Saved', 'Profile']);
    assert.equal(await page.locator('#search-query').getAttribute('placeholder'), 'Search places, addresses, routes');
    assert.equal(await page.locator('#set-language .seg[data-value=en]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => localStorage.getItem('kunde-lang')), 'en');
    // theme
    await page.locator('#set-theme .seg[data-value=light]').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    assert.equal(await page.evaluate(() => localStorage.getItem('kunde-theme')), 'light');
    await page.locator('#set-theme .seg[data-value=dark]').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, 'rgb(13, 16, 21)', 'dark graphite background');
    await page.locator('#set-theme .seg[data-value=system]').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined);
    assert.equal(await page.evaluate(() => localStorage.getItem('kunde-theme')), null);
    assert.ok((await page.evaluate(() => (window.__calls || {}).styles?.length || 0)) >= 0);
    // units
    await page.locator('#set-units .seg[data-value=imperial]').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kunde-settings')).units), 'imperial');
    // low power
    await page.locator('#set-low').click();
    assert.equal(await page.locator('#set-low').getAttribute('aria-checked'), 'true');
    assert.equal(await page.evaluate(() => document.body.classList.contains('low-power')), true);
    assert.match(await page.locator('#privacy-body').innerText(), /stay on your device/);
    assert.match(await page.locator('#about-license').innerText(), /ODbL/);
    // clear data: confirmation dialog first, Cancel changes nothing
    await page.locator('#clear-data').click();
    assert.equal(await page.locator('#dialog').evaluate(d => d.open), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'dialog-cancel', 'the safe button has focus in a destructive dialog');
    await page.locator('#dialog-cancel').click();
    assert.notEqual(await page.evaluate(() => localStorage.getItem('kunde-favorites')), null);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'clear-data', 'focus returns to the opener');
    await page.locator('#clear-data').click();
    await page.locator('#dialog-ok').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('kunde-favorites')), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('kunde-settings')), null);
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ru', 'defaults restored');
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'layers: popover opens with focus, closes with Esc, 3D only outside low-power, traffic is explained as unavailable (no fake layer)'(browser) {
    const {page, context, errors} = await openPage(browser);
    assert.equal(await page.locator('#layers-pop').isHidden(), true);
    await page.locator('#layers-btn').click();
    assert.equal(await page.locator('#layers-pop').isVisible(), true);
    assert.equal(await page.locator('#layers-btn').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'layer-3d');
    assert.match(await page.locator('#layer-traffic-n').innerText(), /нет подтверждённого источника/);
    assert.equal(await page.locator('#layers-pop button').count(), 2, 'traffic has no switch: nothing to turn on');
    const lastStyle = () => page.evaluate(() => { const s = window.__calls.styles.at(-1); return s ? s.style.layers.map(l => l.id) : []; });
    await page.locator('#layer-3d').click();
    await page.waitForFunction(() => window.__calls.styles.length > 0);
    const ids = await lastStyle();
    assert.ok(ids.includes('buildings-3d'), '3D layer added');
    assert.ok(!ids.some(id => /traffic/i.test(id)), 'no traffic layer is ever drawn');
    const layer = await page.evaluate(() => window.__calls.styles.at(-1).style.layers.find(l => l.id === 'buildings-3d'));
    assert.equal(layer.type, 'fill-extrusion');
    assert.deepEqual(layer.paint['fill-extrusion-height'], ['get', 'render_height'], 'real tile heights only');
    assert.ok(JSON.stringify(layer.filter).includes('render_height'), 'buildings without a height stay flat');
    assert.ok((await page.evaluate(() => window.__calls.easeTo.some(o => o.pitch === 50))), 'camera tilts');
    await page.locator('#layer-low').click();
    assert.equal(await page.locator('#layer-3d').isDisabled(), true, '3D is unavailable in low-power mode');
    await page.waitForFunction(() => !window.__calls.styles.at(-1).style.layers.some(l => l.id === 'buildings-3d'));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#layers-pop').isHidden(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'layers-btn');
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'low-end device starts in low-power mode (no 3D, no animations) and says so'(browser) {
    const {page, context} = await openPage(browser, {lowEnd: true});
    assert.equal(await page.evaluate(() => document.body.classList.contains('low-power')), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('sheet')).transitionDuration), '0s');
    await page.locator('#layers-btn').click();
    assert.equal(await page.locator('#layer-3d').isDisabled(), true);
    await context.close();
  },
  async 'reduced motion: the sheet and controls do not animate'(browser) {
    const {page, context} = await openPage(browser, {reducedMotion: true});
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('sheet')).transitionDuration), '0s');
    await page.locator('#sheet-handle').focus(); await page.keyboard.press('ArrowUp');
    assert.equal(await snap(page), 'half');
    await context.close();
  },
  async 'add place: an honest dialog (not available yet), Esc closes it and focus returns'(browser) {
    const {page, context} = await openPage(browser);
    await page.locator('#qa-add').click();
    assert.equal(await page.locator('#dialog').evaluate(d => d.open), true);
    assert.match(await page.locator('#dialog-body').innerText(), /пока недоступно/);
    assert.equal(await page.locator('#dialog-link').getAttribute('href'), 'https://www.openstreetmap.org/');
    assert.equal(await page.locator('#dialog-link').getAttribute('rel'), 'noopener noreferrer');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#dialog').evaluate(d => d.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'qa-add');
    await context.close();
  },
  async 'quick actions: Route and Drive open the planner (Drive preselects the car), Saved opens the list'(browser) {
    const {page, context} = await openPage(browser);
    await page.locator('#qa-drive').click();
    assert.equal(await page.locator('#route-panel').isVisible(), true);
    assert.equal(await page.locator('.mode[data-mode=car]').getAttribute('aria-pressed'), 'true');
    await page.locator('#tabbar .tab[data-tab=search]').click();
    assert.equal(await page.locator('#route-panel').isHidden(), true);
    await page.locator('#qa-fav').click();
    assert.equal(await page.locator('#favorites-panel').isVisible(), true);
    assert.equal(await page.locator('#qa-route').evaluate(el => el.classList.contains('primary')), true);
    await context.close();
  },
  async 'map tools: zoom, compass (only when rotated) and location state with accuracy / denied'(browser) {
    {
      const {page, context} = await openPage(browser, {geo: {latitude: 43.2389, longitude: 76.9457}});
      assert.equal(await page.locator('#compass').isHidden(), true, 'north is up: no compass');
      await page.locator('#zoom-in').click(); await page.locator('#zoom-in').click(); await page.locator('#zoom-out').click();
      assert.equal(await page.evaluate(() => window.__calls.zoom), 1);
      await page.evaluate(() => { window.__bearing = 40; window.__map.fire('rotate'); });
      assert.equal(await page.locator('#compass').isVisible(), true);
      await page.locator('#compass').click();
      assert.equal(await page.locator('#compass').isHidden(), true);
      assert.equal(await page.locator('#locate').getAttribute('data-state'), 'idle');
      assert.match(await page.locator('#locate').getAttribute('aria-label'), /Нажмите, чтобы показать себя/);
      await page.locator('#locate').click();
      await page.locator('#locate[data-state="ok"]').waitFor();
      assert.match(await page.locator('#locate').getAttribute('aria-label'), /Точность около \d+ м/);
      assert.ok((await page.evaluate(() => window.__calls.flyTo.at(-1).center))[0] > 76);
      await context.close();
    }
    {
      const {page, context} = await openPage(browser);   // permission not granted -> denied
      await page.locator('#locate').click();
      await page.locator('#locate[data-state="denied"], #locate[data-state="error"]').waitFor();
      assert.match(await page.locator('#locate').getAttribute('aria-label'), /запрещён|Не удалось/);
      await context.close();
    }
  },
  async 'virtual keyboard: the tab bar gives way and the sheet sits above the keyboard (visualViewport)'(browser) {
    const fake = () => {
      const vv = new EventTarget(); vv.height = window.innerHeight; vv.offsetTop = 0; vv.width = window.innerWidth;
      Object.defineProperty(window, 'visualViewport', {value: vv, configurable: true}); window.__vv = vv;
    };
    const {page, context, errors} = await openPage(browser, {initScript: fake});
    await page.evaluate(() => { window.__vv.height = window.innerHeight - 330; window.__vv.dispatchEvent(new Event('resize')); });
    assert.equal(await page.evaluate(() => document.body.classList.contains('kb-open')), true);
    assert.equal(await page.locator('#tabbar').isHidden(), true, 'tab bar hidden while typing');
    const sheet = await box(page, '#sheet');
    assert.ok(Math.abs(sheet.b - (844 - 330)) <= 1.5, 'sheet bottom sits on the keyboard top: ' + sheet.b);
    await page.evaluate(() => { window.__vv.height = window.innerHeight; window.__vv.dispatchEvent(new Event('resize')); });
    assert.equal(await page.locator('#tabbar').isVisible(), true);
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'desktop: sidebar with search, categories, content and tabs on the left; map on the right; no mobile sheet'(browser) {
    const {page, context, errors} = await openPage(browser, {viewport: {width: 1366, height: 800}, mobile: false});
    const rail = await box(page, '.rail');
    assert.ok(rail.x >= 8 && rail.w >= 380 && rail.w <= 430, 'sidebar width ' + rail.w);
    assert.ok(Math.abs(rail.h - (800 - 28)) <= 2, 'full-height sidebar');
    assert.equal(await page.locator('#sheet-handle').isVisible(), false, 'no drag handle on desktop');
    const tools = await box(page, '#map-tools');
    assert.ok(tools.x > rail.r + 20, 'map tools are on the map, not over the sidebar');
    assert.ok(await page.locator('#tabbar').evaluate((el, railRight) => { const r = el.getBoundingClientRect(); return r.right <= railRight + 1; }, rail.r), 'tabs live inside the sidebar');
    const mapBox = await box(page, '#map');
    assert.deepEqual([mapBox.w, mapBox.h], [1366, 800], 'the map still spans the whole window under the sidebar');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await page.locator('#tabbar .tab[data-tab=profile]').click();
    assert.equal(await page.locator('#profile-panel').isVisible(), true);
    await page.locator('#tabbar .tab[data-tab=search]').click();
    await page.locator('#search-query').fill('Алматы');
    await page.locator('#search-results [role=option]').first().click();
    await page.locator('#selection').waitFor();
    assert.ok((await page.evaluate(() => window.__calls.flyTo.at(-1).padding.left)) > 300, 'the camera keeps the place clear of the sidebar');
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'light theme keeps the same structure and readable colours'(browser) {
    const {page, context} = await openPage(browser, {colorScheme: 'light', storage: {'kunde-theme': 'light'}});
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(244, 246, 250)');
    assert.equal(await page.locator('#tabbar .tab').count(), 5);
    assert.equal(await page.locator('#quick-actions .qa').count(), 4);
    await context.close();
  },
  async 'axe-core (WCAG 2.1 A/AA): no violations on Home, Directions, Saved, Profile, a place card, the layers popover and the dialog, in dark and light'(browser) {
    let axeSource;
    try { axeSource = require('fs').readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); }
    catch (_) { if (process.env.REQUIRE_AXE) throw new Error('axe-core is required (REQUIRE_AXE=1) but not installed'); console.log('     (skipped: axe-core not installed; npm i axe-core)'); return; }
    for (const colorScheme of ['dark', 'light']) {
      const {page, context} = await openPage(browser, {colorScheme, storage: {'kunde-theme': colorScheme}, geo: {latitude: 43.2389, longitude: 76.9457}});
      await page.addScriptTag({content: axeSource});
      const audit = async label => {
        const result = await page.evaluate(() => axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}, rules: {'color-contrast': {enabled: true}}}));
        const bad = result.violations.map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ') + ' [' + (n.any[0] && n.any[0].message || n.failureSummary || '').slice(0, 140) + ']').join(' ; '));
        assert.deepEqual(bad, [], `${colorScheme} / ${label}`);
      };
      await audit('home');
      await page.locator('#sheet-handle').focus(); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(400); await audit('home, sheet half');
      await page.locator('#tabbar .tab[data-tab=route]').click(); await audit('directions');
      await page.locator('#tabbar .tab[data-tab=favorites]').click(); await audit('saved');
      await page.locator('#tabbar .tab[data-tab=profile]').click(); await audit('profile');
      await page.locator('#tabbar .tab[data-tab=search]').click();
      await page.locator('#quick-cats .qcat[data-category=pharmacy]').click(); await page.locator('#places-list .row').first().click(); await page.locator('#selection').waitFor(); await audit('place card');
      await page.locator('#layers-btn').click(); await audit('layers popover'); await page.keyboard.press('Escape');
      await page.locator('#selection-close').click(); await page.locator('#places-clear').click(); await page.locator('#qa-add').click(); await audit('dialog');
      await context.close();
    }
  },
  async 'accessibility smoke: names, roles, one current tab, modal dialog, switches expose state, 200% text does not break the layout'(browser) {
    const {page, context} = await openPage(browser);
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, [role=button], a[href], input, [role=switch]')].filter(e => e.offsetParent !== null || e.closest('.sheet')).filter(e => {
      const name = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || (e.labels && e.labels[0] && e.labels[0].textContent) || '').trim();
      return !name && getComputedStyle(e).display !== 'none' && !e.closest('[hidden]');
    }).map(e => e.id || e.className));
    assert.deepEqual(unnamed, [], 'every visible control has an accessible name');
    assert.equal(await page.locator('nav#tabbar').getAttribute('aria-label'), 'Разделы');
    assert.equal(await page.locator('#tabbar [aria-current]').count(), 1);
    await page.locator('#tabbar .tab[data-tab=profile]').click();
    for (const id of ['set-low', 'set-history']) assert.ok(['true', 'false'].includes(await page.locator('#' + id).getAttribute('aria-checked')));
    for (const g of ['set-language', 'set-theme', 'set-units']) assert.ok((await page.locator('#' + g + ' .seg[aria-pressed="true"]').count()) === 1, g + ' has exactly one pressed option');
    assert.equal(await page.locator('#dialog').getAttribute('aria-labelledby'), 'dialog-title');
    // 200 % text: the browser font size doubles, the layout must still fit the screen
    await page.addStyleTag({content: 'html { font-size: 200% !important; } body { font-size: 200%; }'});
    const m = await page.evaluate(() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}));
    assert.equal(m.sw, m.cw, 'no horizontal scroll with large text');
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
      try { await fn(browser); console.log('ok   -', name); }
      catch (error) { failed++; console.error('FAIL -', name, '\n      ', error.message.split('\n').slice(0, 8).join('\n       ')); }
    }
  } finally { await browser.close(); }
  console.log(failed ? failed + ' shell UI test(s) failed' : 'All shell UI tests passed');
  process.exitCode = failed ? 1 : 0;
})();

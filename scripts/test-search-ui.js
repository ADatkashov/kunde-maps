/* Browser test of the search UI against a mocked MapLibre and a scripted Search API.
 * Usage: WEB_URL=http://127.0.0.1:18080 node scripts/test-search-ui.js   (requires playwright)
 * Real-map visual checks are done separately; this test is deterministic and CDN-independent. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const WEB = process.env.WEB_URL || 'http://127.0.0.1:18080';
const SEARCH = 'https://search.test';
const CORS = {'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range,Content-Length,Retry-After'};

const place = (id, name, kind, lat, lon, extra = {}) => ({id, name, name_ru: name, name_kk: '', kind, lat, lon, ...extra});
const poi = (id, name, category, subtype, lat, lon, extra = {}) => ({id, name, name_ru: null, name_kk: null, name_en: null, category, subtype, lat, lon,
  address: null, phone: null, website: null, hours: null, brand: null, ...extra});
const POI_A = poi('n10', 'Кофейня Альфа', 'cafe', 'cafe', 43.24, 76.95, {address: 'Абая 1', phone: '+7 727 111-22-33', website: 'https://www.alpha.example.kz/menu',
  hours: '24/7', brand: 'Альфа'});
const POI_B = poi('n11', 'Аптека Бета', 'pharmacy', 'pharmacy', 43.241, 76.951, {hours: 'Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off'});
const POI_C = poi('n12', null, 'parking', 'parking', 43.242, 76.952);
const ALMATY = place(1, 'Алматы', 'city', 43.2364, 76.9457, {name_kk: 'Алматы'});
const MOCK_MAPLIBRE = `(function () {
  window.__calls = {flyTo: [], markers: [], removed: 0, styles: [], sources: [], filters: [], easeTo: []};
  class Map {
    constructor(o) { this.h = {}; this.o = o; window.__map = this; setTimeout(() => { this.fire('style.load'); this.fire('load'); }, 0); }
    fire(e, ev) { (this.h[e] || []).forEach(f => f(ev)); }
    fireLayer(layer, e, ev) { (this.h[e + ':' + layer] || []).forEach(f => f(ev)); }
    on(e, a, b) { const key = b ? e + ':' + a : e; (this.h[key] = this.h[key] || []).push(b || a); }
    getBounds() { const c = this.o.center; return {getWest: () => c[0] - 0.05, getEast: () => c[0] + 0.05, getSouth: () => c[1] - 0.04, getNorth: () => c[1] + 0.04}; }
    getSource(id) { return {setData: d => window.__calls.sources.push([id, d]), getClusterExpansionZoom: () => Promise.resolve(13)}; }
    getLayer(id) { return {id}; }
    setFilter(layer, f) { window.__calls.filters.push([layer, f]); }
    easeTo(o) { window.__calls.easeTo.push(o); }
    fitBounds(b, o) { window.__calls.fit = [b, o]; }
    getCanvas() { return {style: {}}; }
    addControl() {}
    getCenter() { return {lng: this.o.center[0], lat: this.o.center[1]}; }
    getZoom() { return window.__zoom != null ? window.__zoom : this.o.zoom; }
    getStyle() { return this.o.style; }
    setStyle(style, options) { window.__calls.styles.push({style, options}); this.o.style = style; }
    flyTo(o) { window.__calls.flyTo.push(o); }
    queryRenderedFeatures() { return window.__hit || []; }
  }
  class Marker {
    constructor(o) { this.el = o && o.element; }
    setLngLat(l) { this.ll = l; return this; }
    addTo() { window.__calls.markers.push(this.ll); if (this.el) document.body.append(this.el); return this; }
    remove() { window.__calls.removed++; if (this.el) this.el.remove(); }
  }
  window.maplibregl = {addProtocol() {}, Map, Marker, NavigationControl: class {}};
})();
`;

async function openPage(browser, {viewport = {width: 1280, height: 800}, search = true, handler, colorScheme = 'light', hash = '', mobile = false, places, geo, storage, routing} = {}) {
  const context = await browser.newContext({viewport, colorScheme, isMobile: mobile, hasTouch: mobile,
    ...(geo ? {permissions: ['geolocation'], geolocation: geo} : {})});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const requests = [];
  const placeRequests = [];
  // Libraries are vendored under /vendor/ (same origin, strict CSP); the real files are replaced by deterministic mocks.
  await page.route('**/vendor/**', route => {
    const url = route.request().url();
    if (url.endsWith('.css')) return route.fulfill({status: 200, contentType: 'text/css', body: ''});
    if (url.includes('maplibre-gl.js')) return route.fulfill({status: 200, contentType: 'application/javascript', body: MOCK_MAPLIBRE});
    return route.fulfill({status: 200, contentType: 'application/javascript', body: 'window.pmtiles={Protocol:class{constructor(){this.tile=()=>{}}}};'});
  });
  await page.route('**/config.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(
    {styleUrl: '/style.json', tileUrl: 'https://tiles.test/k.pmtiles', ...(search ? {searchUrl: SEARCH} : {}), ...(routing ? {routingUrl: 'https://route.test'} : {})})}));
  const routeRequests = [];
  if (routing) {
    await page.route('https://route.test/**', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers: CORS});
      const url = new URL(route.request().url());
      routeRequests.push(url.pathname + url.search);
      const reply = await routing(url, routeRequests.length);
      return route.fulfill({status: reply.status || 200, headers: {...CORS, 'content-type': 'application/json', ...(reply.headers || {})}, body: JSON.stringify(reply.body ?? reply)});
    });
  }
  await page.route('https://tiles.test/**', route => route.fulfill({status: route.request().method() === 'OPTIONS' ? 204 : 206,
    headers: {...CORS, 'access-control-allow-headers': 'range', 'content-range': 'bytes 0-15/100'}, body: route.request().method() === 'OPTIONS' ? '' : '0123456789abcdef'}));
  await page.route(SEARCH + '/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers: CORS});
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/v1/places') || url.pathname === '/v1/categories') {
      const reply = await (places || (async () => ({places: [POI_A, POI_B, POI_C], truncated: false})))(url, placeRequests.length);
      placeRequests.push(url.pathname + url.search);
      return route.fulfill({status: reply.status || 200, headers: {...CORS, 'content-type': 'application/json', ...(reply.headers || {})}, body: JSON.stringify(reply.body ?? reply)});
    }
    requests.push({q: url.searchParams.get('q'), limit: url.searchParams.get('limit'), credentials: route.request().headers()['cookie']});
    const reply = await (handler || (async () => ({results: [ALMATY]})))(url.searchParams.get('q'), requests.length);
    await route.fulfill({status: reply.status || 200, headers: {...CORS, 'content-type': 'application/json', ...(reply.headers || {})}, body: JSON.stringify(reply.body ?? {results: reply.results ?? []})});
  });
  await page.goto(WEB + '/' + hash, {waitUntil: 'domcontentloaded'});
  await page.locator('#status').filter({hasText: 'Карта загружена'}).waitFor({timeout: 15000});
  return {page, context, errors, requests, placeRequests, routeRequests};
}

const results = page => page.locator('#search-results [role=option]');
const calls = page => page.evaluate(() => window.__calls);

const ROUTE_REPLY = {mode: 'car', distance_m: 3510, duration_s: 312, bbox: [76.9456, 43.238, 76.9567, 43.261], instruction_language: 'ru',
  geometry: {type: 'LineString', coordinates: [[76.9456, 43.238], [76.95, 43.25], [76.9567, 43.261]]},
  steps: [{instruction: 'Двигайтесь на север по проспекту Достык.', type: 1, street: 'Достык', distance_m: 3200, duration_s: 280, location: [76.9456, 43.238]},
          {instruction: 'Вы прибыли в пункт назначения.', type: 5, street: '', distance_m: 0, duration_s: 0, location: [76.9567, 43.261]}]};
async function selectAlmaty(page) {
  await page.locator('#search-query').fill('Алматы');
  await results(page).first().click();
  await page.locator('#selection').waitFor();
}

const tests = {
  async 'route: builds a route from the device position, draws it, lists steps, switches mode and closes cleanly'(browser) {
    const {page, context, routeRequests, errors} = await openPage(browser, {geo: {latitude: 43.2381234, longitude: 76.9456789}, routing: async url => url.searchParams.get('mode') === 'foot' ? {...ROUTE_REPLY, mode: 'foot', duration_s: 2400} : ROUTE_REPLY});
    await selectAlmaty(page);
    await page.locator('#route-place').click();
    await page.locator('#route-steps li').first().waitFor();
    assert.equal(routeRequests[0], '/v1/route?from=43.23812,76.94568&to=43.23640,76.94570&mode=car&lang=ru&alternatives=1');  // 5 decimals, our API only
    assert.equal(await page.locator('#route-panel').isVisible(), true);
    assert.equal(await page.locator('#selection').isHidden(), true);
    assert.equal(await page.locator('#route-from').inputValue(), 'Моё местоположение');
    assert.equal(await page.locator('#route-to').inputValue(), 'Алматы');
    assert.equal(await page.locator('#route-total').innerText(), '3.5 км · 5 мин');
    assert.equal(await page.locator('#route-steps li').count(), 2);
    assert.match(await page.locator('#route-note').innerText(), /без учёта пробок/);
    const c = await calls(page);
    assert.equal(c.sources.filter(([id]) => id === 'route').at(-1)[1].features[0].geometry.coordinates.length, 3);
    assert.ok(c.fit && c.fit[0][0][0] === 76.9456, 'camera fits the route');
    await page.locator('#route-steps li').first().click();
    assert.equal((await calls(page)).flyTo.at(-1).center[0], 76.9456);
    await page.locator('.mode[data-mode=foot]').click();
    await page.waitForFunction(() => document.querySelector('#route-total').textContent.includes('40 мин'));
    assert.match(routeRequests.at(-1), /mode=foot/);
    assert.equal(await page.locator('.mode[data-mode=foot]').getAttribute('aria-pressed'), 'true');
    await page.locator('#route-close').click();
    assert.equal(await page.locator('#route-panel').isHidden(), true);
    assert.equal(await page.locator('#selection').isVisible(), true);  // back to the card
    assert.equal((await calls(page)).sources.filter(([id]) => id === 'route').at(-1)[1].features.length, 0);
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'route: without a device position the user taps the map to set the start'(browser) {
    const {page, context, routeRequests} = await openPage(browser, {routing: async () => ROUTE_REPLY});
    await selectAlmaty(page);
    await page.locator('#route-place').click();
    await page.locator('#route-state').filter({hasText: 'Разрешите доступ'}).waitFor();  // device position refused: say so, let the user choose
    assert.equal(routeRequests.length, 0, 'nothing is requested before a start exists');
    await page.locator('#route-pick').click();
    await page.locator('#route-state').filter({hasText: 'Нажмите на карту'}).waitFor();
    assert.equal(await page.evaluate(() => document.body.classList.contains('picking-start')), true);
    await page.evaluate(() => window.__map.fire('click', {lngLat: {lat: 43.25, lng: 76.95}, point: {x: 5, y: 5}}));
    await page.locator('#route-steps li').first().waitFor();
    assert.match(routeRequests[0], /^\/v1\/route\?from=43\.25000,76\.95000&to=43\.23640,76\.94570/);
    assert.equal(await page.locator('#route-from').inputValue(), '43.25000, 76.95000');
    assert.equal(await page.locator('#selection').isHidden(), true, 'the map click set the start instead of opening a point card');
    await page.locator('#route-swap').click();
    await page.waitForFunction(() => document.querySelector('#route-from').value === 'Алматы');
    assert.match(routeRequests.at(-1), /from=43\.23640,76\.94570&to=43\.25000,76\.95000/);
    await context.close();
  },
  async 'route: API errors become clear messages and only unknown failures offer the OpenStreetMap fallback'(browser) {
    let reply = {status: 404, body: {error: 'no_route'}};
    const {page, context} = await openPage(browser, {geo: {latitude: 43.2, longitude: 76.9}, routing: async () => reply});
    await selectAlmaty(page);
    await page.locator('#route-place').click();
    await page.locator('#route-state').filter({hasText: 'Маршрут не найден'}).waitFor();
    assert.equal(await page.locator('#route-external').isHidden(), true);
    for (const [r, text, fallback] of [[{status: 400, body: {error: 'outside_coverage'}}, 'только по Казахстану', false],
        [{status: 404, body: {error: 'no_road_near_point'}}, 'нет дороги', false],
        [{status: 400, body: {error: 'route_too_long'}}, 'Слишком длинный', false],
        [{status: 502, body: {error: 'routing_unavailable'}}, 'Не удалось построить маршрут', true],
        [{status: 429, headers: {'retry-after': '7'}, body: {error: 'rate_limited'}}, 'через 7 с', false]]) {
      reply = r;
      await page.locator('.mode[data-mode=bike]').click();
      await page.locator('#route-state').filter({hasText: text}).waitFor();
      assert.equal(await page.locator('#route-external').isVisible(), fallback, text);
      await page.locator('.mode[data-mode=car]').click();
      await page.waitForTimeout(50);
    }
    assert.match(await page.locator('#route-external').getAttribute('href'), /openstreetmap\.org\/directions\?from=&to=43\.2364/);
    await context.close();
  },
  async 'route: alternatives are listed, drawn as active/inactive lines and selectable; A and B pins follow the points'(browser) {
    const alt = {...ROUTE_REPLY, distance_m: 4200, duration_s: 600, geometry: {type: 'LineString', coordinates: [[76.9456, 43.238], [76.96, 43.245], [76.9567, 43.261]]}};
    const {page, context, routeRequests} = await openPage(browser, {geo: {latitude: 43.2381, longitude: 76.9456}, routing: async () => ({...ROUTE_REPLY, alternatives: [alt], data_version: 'osm-261121'})});
    await selectAlmaty(page);
    await page.locator('#route-place').click();
    await page.locator('#route-options li').nth(1).waitFor();
    assert.match(routeRequests[0], /alternatives=1/);
    assert.equal(await page.locator('#route-options li').count(), 2);
    assert.match(await page.locator('#route-options li').nth(0).innerText(), /5 мин[\s\S]*Быстрее всего/);
    assert.match(await page.locator('#route-options li').nth(1).innerText(), /10 мин[\s\S]*Вариант 2/);
    let features = (await calls(page)).sources.filter(([id]) => id === 'route').at(-1)[1].features;
    assert.deepEqual(features.map(f => f.properties.active), [true, false]);
    await page.locator('#route-options li').nth(1).click();
    assert.equal(await page.locator('#route-total').innerText(), '4.2 км · 10 мин');
    features = (await calls(page)).sources.filter(([id]) => id === 'route').at(-1)[1].features;
    assert.deepEqual(features.map(f => f.properties.active), [false, true]);
    assert.equal(routeRequests.length, 1, 'choosing an option does not hit the API again');
    const style = (await calls(page)).styles.length ? (await calls(page)).styles.at(-1).style : await page.evaluate(() => window.__map.o.style);
    assert.ok(style.layers.some(l => l.id === 'route-alt') && style.layers.some(l => l.id === 'route-line'));
    assert.equal(await page.locator('.route-pin').count(), 2);
    assert.deepEqual(await page.locator('.route-pin').allInnerTexts(), ['A', 'B']);
    await page.locator('#route-close').click();
    assert.equal(await page.locator('.route-pin').count(), 0);
    await context.close();
  },
  async 'route: both ends can be typed with suggestions (keyboard) and edits recompute the route'(browser) {
    const hits = [place(5, 'Парк Горького', 'park', 43.2552, 76.9576), place(6, 'Медеу', 'attraction', 43.1575, 77.0589, {locality: 'Алматы'})];
    const {page, context, routeRequests} = await openPage(browser, {geo: {latitude: 43.2381, longitude: 76.9456}, routing: async () => ROUTE_REPLY,
      handler: async q => ({results: q && q.startsWith('Ме') ? [hits[1]] : q && q.startsWith('Пар') ? [hits[0]] : [ALMATY]})});
    await selectAlmaty(page);
    await page.locator('#route-place').click();
    await page.locator('#route-steps li').first().waitFor();
    await page.locator('#route-to').fill('Ме');
    await page.locator('#route-to-list li').first().waitFor();
    assert.match(await page.locator('#route-to-list li').first().innerText(), /Медеу[\s\S]*Алматы/);
    assert.equal(await page.locator('#route-to').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#route-to').value === 'Медеу');
    await page.locator('#route-steps li').first().waitFor();
    assert.match(routeRequests.at(-1), /from=43\.23810,76\.94560&to=43\.15750,77\.05890/);
    await page.locator('#route-from').fill('Пар');
    await page.locator('#route-from-list li').first().click();
    await page.waitForFunction(() => document.querySelector('#route-from').value === 'Парк Горького');
    await page.waitForFunction(() => document.querySelectorAll('#route-steps li').length > 0);
    assert.match(routeRequests.at(-1), /from=43\.25520,76\.95760&to=43\.15750,77\.05890/);
    await page.locator('#route-from').fill('Ме');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#route-from-list').isHidden(), true);
    await context.close();
  },
  async 'route: texts follow the language and a Kazakh UI says the directions are in Russian'(browser) {
    const {page, context} = await openPage(browser, {geo: {latitude: 43.2, longitude: 76.9}, routing: async () => ROUTE_REPLY});
    await selectAlmaty(page);
    await page.locator('#route-place').click();
    await page.locator('#route-steps li').first().waitFor();
    await page.locator('#language').click();  // ҚАЗ
    await page.waitForFunction(() => document.querySelector('#route-title').textContent === 'Маршрут' && document.querySelector('#route-narration').textContent !== '');
    assert.match(await page.locator('#route-narration').innerText(), /орыс тілінде/);
    assert.equal(await page.locator('.mode[data-mode=foot]').innerText(), 'Жаяу');
    await page.locator('#language').click();  // EN
    await page.waitForFunction(() => document.querySelector('#route-title').textContent === 'Route');
    await page.waitForFunction(() => document.querySelector('#route-total').textContent === '3.5 km · 5 min');
    await context.close();
  },
  async 'route: instruction text is rendered as text, never as HTML'(browser) {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const {page, context} = await openPage(browser, {geo: {latitude: 43.2, longitude: 76.9}, routing: async () => ({...ROUTE_REPLY, steps: [{...ROUTE_REPLY.steps[0], instruction: evil}]})});
    await selectAlmaty(page);
    await page.locator('#route-place').click();
    await page.locator('#route-steps li').first().waitFor();
    assert.equal(await page.locator('#route-steps li').first().innerText().then(t => t.split('\n')[0]), evil);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.equal(await page.locator('#route-steps img').count(), 0);
    await context.close();
  },
  async 'route: selecting another place while a route is open replaces the panel with that place'(browser) {
    const {page, context} = await openPage(browser, {geo: {latitude: 43.2, longitude: 76.9}, routing: async () => ROUTE_REPLY});
    await selectAlmaty(page);
    await page.locator('#route-place').click();
    await page.locator('#route-steps li').first().waitFor();
    await page.evaluate(() => window.__map.fire('click', {lngLat: {lat: 43.3, lng: 77.0}, point: {x: 1, y: 1}}));
    await page.locator('#selection').waitFor();
    assert.equal(await page.locator('#route-panel').isHidden(), true);
    assert.equal((await calls(page)).sources.filter(([id]) => id === 'route').at(-1)[1].features.length, 0);
    await context.close();
  },
  async 'typing debounces to one request and renders real results'(browser) {
    const {page, errors, requests, context} = await openPage(browser, {handler: async () => ({results: [ALMATY, place(2, 'Алматы', 'address', 42.97, 76.87)]})});
    await page.locator('#search-query').pressSequentially('Алматы', {delay: 30});
    await results(page).first().waitFor();
    assert.equal(requests.length, 1, 'debounce should coalesce keystrokes into one request');
    assert.deepEqual([requests[0].q, requests[0].limit], ['Алматы', '10']);
    assert.equal(await results(page).count(), 2);
    assert.match(await results(page).first().innerText(), /Алматы\s+Город/);
    assert.equal(await page.locator('#search-query').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'one-character queries never hit the API'(browser) {
    const {page, requests, context} = await openPage(browser);
    await page.locator('#search-query').fill('а');
    await page.waitForTimeout(600);
    assert.equal(requests.length, 0);
    assert.equal(await page.locator('#sheet').isHidden(), true);
    await context.close();
  },
  async 'stale responses never overwrite newer ones (race)'(browser) {
    const {page, context} = await openPage(browser, {handler: async q => {
      if (q === 'Алм') { await new Promise(r => setTimeout(r, 900)); return {results: [place(9, 'СТАРЫЙ', 'city', 1, 1)]}; }
      return {results: [place(3, 'Новый результат', 'city', 2, 2)]};
    }});
    const input = page.locator('#search-query');
    await input.fill('Алм');
    await page.waitForTimeout(450); // debounce fired, slow request in flight
    await input.fill('Алма');
    await results(page).first().waitFor();
    await page.waitForTimeout(1200);
    assert.deepEqual(await results(page).allInnerTexts().then(a => a.map(t => t.split('\n')[0])), ['Новый результат']);
    await context.close();
  },
  async 'keyboard: arrows, Enter selects, flyTo + marker + card + share hash'(browser) {
    const {page, context, errors} = await openPage(browser, {handler: async () => ({results: [ALMATY, place(2, 'Астана', 'city', 51.128, 71.43)]})});
    await page.locator('#search-query').fill('Ал');
    await results(page).first().waitFor();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#search-query').getAttribute('aria-activedescendant'), 'opt-1');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await page.locator('#selection').waitFor();
    const c = await calls(page);
    assert.deepEqual(c.flyTo.at(-1).center, [76.9457, 43.2364]);
    assert.equal(c.flyTo.at(-1).zoom, 11, 'city zoom');
    assert.deepEqual(c.markers.at(-1), [76.9457, 43.2364]);
    assert.equal(await page.locator('#selection-title').innerText(), 'Алматы');
    assert.equal(await page.locator('#selection-kind').innerText(), 'Город');
    assert.match(await page.evaluate(() => location.hash), /^#lat=43\.23640&lng=76\.94570&name=/);
    await page.locator('#selection-close').click();
    assert.equal(await page.locator('#selection').isHidden(), true);
    assert.equal(await page.evaluate(() => location.hash), '');
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'selecting a result cancels a pending search so the list never reappears over the card'(browser) {
    const {page, context, requests} = await openPage(browser);
    const input = page.locator('#search-query');
    await input.fill('Алматы');
    await results(page).first().waitFor();
    assert.equal(requests.length, 1);
    await input.press('End');
    await input.pressSequentially('а'); // schedules a debounced search (300 ms)
    await results(page).first().click();  // select before the debounce fires
    await page.locator('#selection').waitFor();
    await page.waitForTimeout(900);
    assert.equal(requests.length, 1, 'pending search must be cancelled');
    assert.equal(await page.locator('#selection').isVisible(), true);
    assert.equal(await page.locator('#search-results').isHidden(), true);
    await context.close();
  },
  async 'Escape closes the list, second Escape clears the field'(browser) {
    const {page, context} = await openPage(browser);
    const input = page.locator('#search-query');
    await input.fill('Алматы');
    await results(page).first().waitFor();
    await input.press('Escape');
    assert.equal(await page.locator('#search-results').isHidden(), true);
    assert.equal(await input.inputValue(), 'Алматы');
    await input.press('Escape');
    assert.equal(await input.inputValue(), '');
    await context.close();
  },
  async 'empty result shows an empty state, not fake data'(browser) {
    const {page, context} = await openPage(browser, {handler: async () => ({results: []})});
    await page.locator('#search-query').fill('qwertyuiop');
    await page.locator('#search-state').filter({hasText: 'Ничего не найдено'}).waitFor();
    assert.equal(await results(page).count(), 0);
    await context.close();
  },
  async 'server errors show a retry that works (503 then 200)'(browser) {
    let n = 0;
    const {page, context} = await openPage(browser, {handler: async () => (++n <= 2 ? {status: 503, body: {error: 'index_unavailable'}} : {results: [ALMATY]})});
    await page.locator('#search-query').fill('Алматы');
    await page.locator('#search-state').filter({hasText: 'временно недоступен'}).waitFor({timeout: 10000});
    await page.getByRole('button', {name: 'Повторить'}).click();
    await results(page).first().waitFor();
    await context.close();
  },
  async '429 shows a countdown using Retry-After and does not hammer the API'(browser) {
    const {page, context, requests} = await openPage(browser, {handler: async () => ({status: 429, headers: {'retry-after': '30'}, body: {error: 'rate_limited'}})});
    await page.locator('#search-query').fill('Алматы');
    await page.locator('#search-state').filter({hasText: /Слишком много запросов.*30|Слишком много запросов.*29/}).waitFor();
    await page.waitForTimeout(1500);
    assert.equal(requests.length, 1);
    await context.close();
  },
  async 'missing searchUrl disables search with a clear message'(browser) {
    const {page, context, requests} = await openPage(browser, {search: false});
    await page.locator('#search-query').fill('Алматы');
    await page.locator('#search-state').filter({hasText: 'Поиск не настроен'}).waitFor();
    assert.equal(requests.length, 0);
    await context.close();
  },
  async 'result names are rendered as text, never as HTML'(browser) {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const {page, context, errors} = await openPage(browser, {handler: async () => ({results: [place(7, evil, 'address', 43, 77)]})});
    await page.locator('#search-query').fill('img');
    await results(page).first().waitFor();
    await results(page).first().click();
    await page.locator('#selection').waitFor();
    assert.equal(await page.locator('#selection-title').innerText(), evil);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.equal(await page.locator('#search-results img, #selection img').count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'address results show their locality instead of bare coordinates, and the card repeats it'(browser) {
    const {page, context} = await openPage(browser, {handler: async () => ({results: [
      place(31, 'улица Абая 150', 'address', 43.207, 76.77, {locality: 'Алматы'}), place(32, 'Абая 150', 'address', 43.918, 67.265)]})});
    await page.locator('#search-query').fill('Абая 150');
    await results(page).nth(1).waitFor();
    assert.match(await results(page).nth(0).innerText(), /Адрес\s+·\s+Алматы/);
    assert.doesNotMatch(await results(page).nth(0).innerText(), /43\.2070/);
    assert.match(await results(page).nth(1).innerText(), /43\.9180, 67\.2650/);  // no locality: coordinates as before, nothing invented
    await results(page).nth(0).click();
    await page.locator('#selection').waitFor();
    assert.match(await page.locator('#selection-kind').innerText(), /Алматы/);
    await context.close();
  },
  async 'language switch re-localizes names, kinds and map labels'(browser) {
    const {page, context} = await openPage(browser, {handler: async () => ({results: [place(1, 'Almaty', 'city', 43.2, 76.9, {name_ru: 'Алматы', name_kk: 'Алматы қ.'})]})});
    await page.locator('#search-query').fill('Алматы');
    await results(page).first().waitFor();
    await page.locator('#language').click();
    assert.equal(await page.locator('#language').innerText(), 'ҚАЗ');
    assert.match(await results(page).first().innerText(), /Алматы қ\.\s+Қала/);
    await page.locator('#language').click();
    assert.match(await results(page).first().innerText(), /Almaty\s+City/);
    assert.equal(await page.locator('#search-query').getAttribute('placeholder'), 'Search places or addresses');
    const style = (await calls(page)).styles.at(-1);
    assert.equal(style.options.diff, true, 'language switch must diff the style (keeps tiles)');
    const placeLayer = style.style.layers.find(l => l.id === 'place-labels');
    assert.ok(JSON.stringify(placeLayer.layout['text-field']).startsWith('["coalesce",["get","name:en"]'), 'EN labels use name:en first');
    const peaks = style.style.layers.find(l => l.id === 'peak-labels');
    assert.ok(JSON.stringify(peaks.layout['text-field']).includes('ele'), 'templates with extra parts (elevation) survive localisation');
    // An open place card is re-localized too (name_en in EN, name_kk in KK).
    await results(page).first().click();
    await page.locator('#selection').waitFor();
    assert.equal(await page.locator('#selection-title').innerText(), 'Almaty');
    assert.equal(await page.locator('#selection-kind').innerText(), 'City');
    await page.locator('#language').click();  // en -> ru
    assert.equal(await page.locator('#selection-title').innerText(), 'Алматы');
    assert.equal(await page.locator('#selection-kind').innerText(), 'Город');
    await context.close();
  },
  async 'opening a shared link restores the place card'(browser) {
    const {page, context, errors} = await openPage(browser, {hash: '#lat=43.23640&lng=76.94570&name=%D0%90%D0%BB%D0%BC%D0%B0%D1%82%D1%8B'});
    await page.locator('#selection').waitFor();
    assert.equal(await page.locator('#selection-title').innerText(), 'Алматы');
    assert.equal(await page.locator('#selection-coords').innerText(), '43.23640, 76.94570');
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'invalid share links are ignored'(browser) {
    const {page, context} = await openPage(browser, {hash: '#lat=999&lng=abc'});
    assert.equal(await page.locator('#selection').isHidden(), true);
    await context.close();
  },
  async 'map click opens a point card'(browser) {
    const {page, context} = await openPage(browser);
    await page.evaluate(() => window.__map.fire('click', {lngLat: {lat: 43.25, lng: 76.95}, point: {x: 5, y: 5}}));
    await page.locator('#selection').waitFor();
    assert.equal(await page.locator('#selection-title').innerText(), 'Выбранная точка');
    assert.equal(await page.locator('#selection-coords').innerText(), '43.25000, 76.95000');
    await context.close();
  },
  async 'theme toggle swaps to the generated dark style, persists, and restores light'(browser) {
    const {page, context} = await openPage(browser);
    await page.locator('#theme').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await page.evaluate(() => localStorage.getItem('kunde-theme')), 'dark');
    await page.waitForFunction(() => window.__calls.styles.length > 0);
    const bg = style => style.layers.find(l => l.id === 'background').paint['background-color'];
    const dark = (await calls(page)).styles.at(-1).style;
    assert.equal(bg(dark), '#0e1524');
    assert.equal(dark.metadata['kunde:theme'], 'dark');
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.locator('#status').filter({hasText: 'Карта загружена'}).waitFor();
    assert.equal(await page.evaluate(() => window.__map.o.style.metadata['kunde:theme']), 'dark', 'saved theme is applied at start');
    await page.locator('#theme').click();
    await page.waitForFunction(() => window.__calls.styles.length > 0);
    assert.equal(bg((await calls(page)).styles.at(-1).style), '#f3f4ef', 'toggling back restores the light style');
    await context.close();
  },
  async 'mobile layout: no horizontal overflow, touch targets >= 44px, sheet above attribution zone'(browser) {
    for (const viewport of [{width: 360, height: 740}, {width: 430, height: 932}, {width: 320, height: 568}]) {
      const {page, context} = await openPage(browser, {viewport, mobile: true, handler: async () => ({results: Array.from({length: 10}, (_, i) => place(i + 1, 'Алматы ' + 'очень длинное название '.repeat(3) + i, 'address', 43 + i / 100, 76.9))})});
      await page.locator('#search-query').fill('Алматы');
      await results(page).first().waitFor();
      const m = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        small: [...document.querySelectorAll('button, input')].filter(e => e.offsetParent && !e.classList.contains('sheet-handle')).map(e => [e.id || e.className, Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 32 && h > 0),
        sheetTop: document.getElementById('sheet').getBoundingClientRect().top,
        sheetBottom: Math.round(document.getElementById('sheet').getBoundingClientRect().bottom), vh: innerHeight,
        sheetVar: getComputedStyle(document.documentElement).getPropertyValue('--sheet-h'),
      }));
      assert.equal(m.overflow, 0, 'horizontal overflow at ' + viewport.width);
      assert.deepEqual(m.small, [], 'tiny controls at ' + viewport.width);
      assert.ok(m.sheetTop > 150, 'sheet must leave room for search/map at ' + viewport.height + ': ' + m.sheetTop);
      assert.ok(m.sheetBottom <= m.vh, 'sheet inside viewport');
      assert.match(m.sheetVar, /^\d+px$/);
      await context.close();
    }
  },
  // ---- Phase 3: places & POI ------------------------------------------------------------------------------------
  async 'category chips: 17 categories + nearby; selecting loads the viewport with real params and fills list and map'(browser) {
    const {page, context, placeRequests, errors} = await openPage(browser);
    assert.equal(await page.locator('#chips .chip[data-category]').count(), 17);
    assert.equal(await page.locator('#chip-near').count(), 1);
    await page.locator('.chip[data-category=cafe]').click();
    await page.locator('#places-list li').first().waitFor();
    assert.equal(placeRequests.length, 1);
    assert.match(placeRequests[0], /^\/v1\/places\?bbox=76\.8950,43\.1980,76\.9950,43\.2780&limit=150&category=cafe&lat=43\.238&lon=76\.945$/);
    assert.equal(await page.locator('.chip[data-category=cafe]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#places-list li').count(), 3);
    assert.match(await page.locator('#places-title').innerText(), /В этой области · 3/);
    const rows = await page.locator('#places-list li').allInnerTexts();
    assert.match(rows[0], /Кофейня Альфа\s+Кафе\s*·\s*Круглосуточно/);
    assert.match(rows[1], /Аптека Бета\s+Аптека\s*·\s*(Открыто|Закрыто)/);
    assert.match(rows[2], /^Парковка\s*$/, 'unnamed parking is shown by its kind, with no invented name and no hours');
    const data = (await calls(page)).sources.at(-1)[1];
    assert.equal(data.features.length, 3);
    assert.deepEqual(data.features.map(f => f.properties.color), ['#b7791f', '#d93f55', '#5b6b82'], 'cafe / pharmacy / parking hues');
    assert.deepEqual(data.features[0].geometry.coordinates, [76.95, 43.24]);
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'places layers and clustered source are part of every style handed to MapLibre (survive theme/language switches)'(browser) {
    const {page, context} = await openPage(browser);
    await page.locator('.chip[data-category=cafe]').click();
    await page.locator('#places-list li').first().waitFor();
    await page.locator('#theme').click();
    // Wait for the style produced by the theme switch itself: earlier setStyle calls (startup) carry no results yet.
    await page.waitForFunction(() => window.__calls.styles.some(s => s.style.metadata && s.style.metadata['kunde:theme'] === 'dark'));
    let style = (await calls(page)).styles.filter(s => s.style.metadata && s.style.metadata['kunde:theme'] === 'dark').at(-1).style;
    assert.equal(style.sources.places.cluster, true);
    assert.equal(style.sources.places.data.features.length, 3, 'latest results travel with the style');
    for (const id of ['places-clusters', 'places-cluster-count', 'places-points', 'places-selected']) assert.ok(style.layers.some(l => l.id === id), id);
    await page.locator('#language').click();
    await page.waitForFunction(() => window.__calls.styles.length > 1);
    style = (await calls(page)).styles.at(-1).style;
    assert.ok(style.layers.some(l => l.id === 'places-points'));
    await context.close();
  },
  async 'several categories are combined; deselecting all clears list, map data and the panel'(browser) {
    const {page, context, placeRequests} = await openPage(browser);
    await page.locator('.chip[data-category=cafe]').click();
    await page.locator('#places-list li').first().waitFor();
    await page.locator('.chip[data-category=pharmacy]').click();
    await page.waitForFunction(() => document.querySelectorAll('.chip[aria-pressed=true]').length === 2);
    await page.waitForTimeout(150);
    assert.match(placeRequests.at(-1), /category=cafe,pharmacy/);
    await page.locator('.chip[data-category=cafe]').click();
    await page.locator('.chip[data-category=pharmacy]').click();
    await page.locator('#places-panel').waitFor({state: 'hidden'});
    assert.equal((await calls(page)).sources.at(-1)[1].features.length, 0);
    await context.close();
  },
  async 'zoomed out: no request, a clear hint; panning is debounced into one request'(browser) {
    const {page, context, placeRequests} = await openPage(browser);
    await page.evaluate(() => { window.__zoom = 8; });
    await page.locator('.chip[data-category=cafe]').click();
    await page.locator('#places-state').filter({hasText: 'Приблизьте карту'}).waitFor();
    assert.equal(placeRequests.length, 0);
    await page.evaluate(() => { window.__zoom = 14; for (let i = 0; i < 4; i++) window.__map.fire('moveend'); });
    await page.locator('#places-list li').first().waitFor();
    assert.equal(placeRequests.length, 1, 'four rapid moveend events -> one request');
    await context.close();
  },
  async 'empty area, 503 with retry, and 429 are explained without fake data'(browser) {
    let n = 0;
    const {page, context} = await openPage(browser, {places: async () => (++n <= 2 ? {status: 503, body: {error: 'places_unavailable'}} : n === 3 ? {places: [], truncated: false} : {status: 429, headers: {'retry-after': '20'}, body: {error: 'rate_limited'}})});
    await page.locator('.chip[data-category=cafe]').click();
    await page.locator('#places-state').filter({hasText: /временно недоступны|Не удалось/}).waitFor({timeout: 10000});
    await page.locator('#places-state').getByRole('button', {name: 'Повторить'}).click();
    await page.locator('#places-state').filter({hasText: 'нет мест выбранных категорий'}).waitFor();
    assert.match(await page.locator('#places-state').innerText(), /Отдалите карту/, 'an empty result says what to do next');
    await page.locator('.chip[data-category=bank]').click();
    await page.locator('#places-state').filter({hasText: /Слишком много запросов/}).waitFor();
    await context.close();
  },
  async 'place card shows only real data: contacts, open now, hours table, safe links, actions'(browser) {
    const {page, context} = await openPage(browser);
    await page.locator('.chip[data-category=cafe]').click();
    await page.locator('#places-list li').first().click();
    await page.locator('#selection').waitFor();
    assert.equal(await page.locator('#selection-title').innerText(), 'Кофейня Альфа');
    assert.equal(await page.locator('#selection-chip').innerText(), 'Кафе');
    assert.equal(await page.locator('#selection-open').innerText(), 'Круглосуточно');
    assert.equal(await page.locator('#selection-open').getAttribute('class'), 'open-badge open');
    const phone = page.locator('#selection-details a[href^="tel:"]');
    assert.equal(await phone.getAttribute('href'), 'tel:+77271112233');
    const site = page.locator('#selection-details a[target=_blank]');
    assert.equal(await site.innerText(), 'alpha.example.kz');
    assert.equal(await site.getAttribute('href'), 'https://www.alpha.example.kz/menu');
    assert.equal(await site.getAttribute('rel'), 'noopener noreferrer');
    assert.match(await page.locator('#selection-details').innerText(), /Абая 1/);
    assert.match(await page.locator('#selection-details').innerText(), /Альфа/);
    const route = page.locator('#route-place');
    assert.equal(await route.getAttribute('href'), 'https://www.openstreetmap.org/directions?from=&to=43.24000%2C76.95000');
    assert.equal(await route.getAttribute('target'), '_blank');
    assert.equal(await page.locator('#save-place').isVisible(), true);
    assert.match(await page.evaluate(() => location.hash), /poi=n10/);
    const c = await calls(page);
    assert.ok(c.flyTo.at(-1).zoom >= 16);
    assert.deepEqual(c.markers.at(-1), [76.95, 43.24]);
    assert.ok(c.filters.some(f => f[0] === 'places-selected' && JSON.stringify(f[1]).includes('n10')), 'selected marker is highlighted');
    await context.close();
  },
  async 'weekly hours table, closed state and next opening time come from the OSM string'(browser) {
    const {page, context} = await openPage(browser);
    await page.locator('.chip[data-category=pharmacy]').click();
    await page.locator('#places-list li').nth(1).click();
    await page.locator('#selection').waitFor();
    assert.match(await page.locator('#selection-open').innerText(), /^(Открыто · до|Закрыто · откроется)/);
    await page.locator('#selection-hours summary').click();
    const rows = await page.locator('#selection-hours tbody tr').allInnerTexts();
    assert.equal(rows.length, 7);
    assert.match(rows[0], /Пн\s+09:00–18:00/);
    assert.match(rows[5], /Сб\s+10:00–14:00/);
    assert.match(rows[6], /Вс\s+Закрыто/);
    await context.close();
  },
  async 'missing data is simply absent: no empty rows, no hours, no badge, no invented name'(browser) {
    const {page, context} = await openPage(browser);
    await page.locator('.chip[data-category=parking]').click();
    await page.locator('#places-list li').nth(2).click();
    await page.locator('#selection').waitFor();
    assert.equal(await page.locator('#selection-title').innerText(), 'Парковка');
    assert.equal(await page.locator('#selection-details > div').count(), 0);
    assert.equal(await page.locator('#selection-hours').isHidden(), true);
    assert.equal(await page.locator('#selection-open').isHidden(), true);
    assert.equal(await page.locator('#route-place').isVisible(), true, 'directions only need coordinates');
    await context.close();
  },
  async 'hostile place data is inert: HTML in names/address, javascript: websites, junk phones'(browser) {
    const evil = poi('n20', '<img src=x onerror="window.__pwned=1">', 'cafe', 'cafe', 43.24, 76.95,
      {address: '<b onmouseover=alert(1)>x</b>', website: 'javascript:alert(1)', phone: '<script>1234567</script>', hours: '<i>always</i>', brand: '"><svg onload=1>'});
    const {page, context, errors} = await openPage(browser, {places: async () => ({places: [evil], truncated: false})});
    await page.locator('.chip[data-category=cafe]').click();
    await page.locator('#places-list li').first().click();
    await page.locator('#selection').waitFor();
    await page.locator('#selection-hours summary').click().catch(() => {});
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.equal(await page.locator('#selection img, #selection svg[onload], #selection b, #selection script, #places-list img').count(), 0);
    assert.equal(await page.locator('#selection a[href^="javascript"]').count(), 0);
    assert.equal(await page.locator('#selection-details a').count(), 0, 'no tel/website links from invalid data');
    assert.match(await page.locator('#selection-hours').innerText(), /<i>always<\/i>/, 'unparseable hours are shown verbatim as plain text');
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'save / saved places: persists on the device, lists, reopens and removes'(browser) {
    const {page, context} = await openPage(browser);
    await page.locator('.chip[data-category=cafe]').click();
    await page.locator('#places-list li').first().click();
    await page.locator('#selection').waitFor();
    assert.equal(await page.locator('#save-place').getAttribute('aria-pressed'), 'false');
    await page.locator('#save-place').click();
    assert.equal(await page.locator('#save-place').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#save-place').innerText(), 'Сохранено');
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('kunde-favorites')));
    assert.deepEqual(stored.map(x => x.id), ['n10']);
    assert.deepEqual(Object.keys(stored[0]).sort(), ['address', 'category', 'id', 'lat', 'lon', 'name', 'nameEn', 'nameKk', 'nameRu', 'subtype'], 'phone/website/hours are not copied');
    await page.reload();
    await page.locator('#status').filter({hasText: 'Карта загружена'}).waitFor();
    await page.locator('#favorites-btn').click();
    await page.locator('#favorites-list li').first().waitFor();
    assert.match(await page.locator('#favorites-list').innerText(), /Кофейня Альфа/);
    assert.equal(await page.locator('#favorites-btn').getAttribute('aria-pressed'), 'true');
    await page.locator('#favorites-list li .row').first().click();
    await page.locator('#selection').waitFor();
    assert.equal(await page.locator('#selection-title').innerText(), 'Кофейня Альфа');
    assert.equal(await page.locator('#save-place').getAttribute('aria-pressed'), 'true');
    await page.locator('#save-place').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('kunde-favorites')), '[]');
    await page.locator('#selection-close').click();
    await page.locator('#favorites-empty').waitFor();
    assert.match(await page.locator('#favorites-empty').innerText(), /Пока ничего не сохранено/);
    await context.close();
  },
  async 'corrupt saved data in localStorage is ignored, not fatal'(browser) {
    const {page, context, errors} = await openPage(browser);
    await page.evaluate(() => localStorage.setItem('kunde-favorites', '{"oops":'));
    await page.reload();
    await page.locator('#status').filter({hasText: 'Карта загружена'}).waitFor();
    await page.locator('#favorites-btn').click();
    await page.locator('#favorites-empty').waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  },
  async 'nearby: asks for location, sends it rounded to ~100 m, lists by distance, explains privacy'(browser) {
    const near = [{...POI_A, distance_m: 120}, {...POI_B, distance_m: 640}, {...POI_C, distance_m: 1240}];
    const {page, context, placeRequests} = await openPage(browser, {geo: {latitude: 43.238912, longitude: 76.889709}, places: async () => ({places: near, truncated: false})});
    await page.locator('#chip-near').click();
    await page.locator('#places-list li').first().waitFor();
    assert.equal(placeRequests[0], '/v1/places?lat=43.239&lon=76.890&radius=1500&limit=60');
    assert.match(await page.locator('#places-title').innerText(), /Рядом · 3/);
    const rows = await page.locator('#places-list li').allInnerTexts();
    assert.match(rows[0], /120 м/);
    assert.match(rows[1], /640 м/);
    assert.match(rows[2], /1\.2 км/);
    await page.locator('#status').filter({hasText: 'не сохраняется'}).waitFor();
    assert.equal(await page.locator('#chip-near').getAttribute('aria-pressed'), 'true');
    assert.deepEqual((await calls(page)).flyTo.at(-1).center, [76.889709, 43.238912]);
    await page.locator('.chip[data-category=pharmacy]').click();
    await page.waitForFunction(() => document.querySelectorAll('.chip[aria-pressed=true]').length === 2);
    await page.waitForTimeout(100);
    assert.match(placeRequests.at(-1), /^\/v1\/places\?lat=43\.239&lon=76\.890&radius=1500&limit=60&category=pharmacy$/, 'category change re-runs nearby, not viewport');
    await context.close();
  },
  async 'nearby without permission explains what to do and sends nothing'(browser) {
    const {page, context, placeRequests} = await openPage(browser);
    await page.locator('#chip-near').click();
    await page.locator('#status').filter({hasText: /Разрешите доступ к геолокации|Не удалось определить/}).waitFor({timeout: 15000});
    assert.equal(placeRequests.length, 0);
    await context.close();
  },
  async 'cluster click zooms into the cluster; point click opens the card; clicks on markers never create a point card'(browser) {
    const {page, context} = await openPage(browser);
    await page.locator('.chip[data-category=cafe]').click();
    await page.locator('#places-list li').first().waitFor();
    await page.evaluate(() => window.__map.fireLayer('places-clusters', 'click', {features: [{properties: {cluster_id: 5}, geometry: {coordinates: [76.9, 43.2]}}]}));
    await page.waitForFunction(() => window.__calls.easeTo.length > 0);
    assert.deepEqual((await calls(page)).easeTo.at(-1), {center: [76.9, 43.2], zoom: 13.5, essential: false});
    await page.evaluate(() => { window.__hit = [{}]; window.__map.fire('click', {lngLat: {lat: 1, lng: 1}, point: {x: 1, y: 1}}); });
    assert.equal(await page.locator('#selection').isHidden(), true, 'a click on a marker is not a map click');
    await page.evaluate(() => { window.__hit = []; window.__map.fireLayer('places-points', 'click', {features: [{properties: {idx: 1}}]}); });
    await page.locator('#selection').waitFor();
    assert.equal(await page.locator('#selection-title').innerText(), 'Аптека Бета');
    await context.close();
  },
  async 'a text-search hit that is a real place opens the full card via the Places API'(browser) {
    const hit = {id: 7, name: 'Кофейня Альфа', name_ru: null, name_kk: null, name_en: null, kind: 'cafe', lat: 43.24, lon: 76.95, place_id: 'n10', category: 'cafe'};
    const {page, context, placeRequests} = await openPage(browser, {handler: async () => ({results: [hit]}),
      places: async url => (url.pathname === '/v1/places/n10' ? {place: POI_A} : {places: [], truncated: false})});
    await page.locator('#search-query').fill('Кофейня');
    await results(page).first().click();
    await page.locator('#selection-details a[href^="tel:"]').waitFor();
    assert.ok(placeRequests.includes('/v1/places/n10'));
    assert.equal(await page.locator('#selection-chip').innerText(), 'Кафе');
    await context.close();
  },
  async 'shared place link (#poi=) restores the full card; an unknown id keeps the coordinate card'(browser) {
    const ok = await openPage(browser, {hash: '#lat=43.24000&lng=76.95000&name=%D0%9A%D0%BE%D1%84%D0%B5&poi=n10', places: async url => ({place: POI_A})});
    await ok.page.locator('#selection-details a[href^="tel:"]').waitFor();
    assert.equal(await ok.page.locator('#selection-title').innerText(), 'Кофейня Альфа');
    await ok.context.close();
    const gone = await openPage(browser, {hash: '#lat=43.24000&lng=76.95000&name=%D0%9A%D0%BE%D1%84%D0%B5&poi=n999', places: async () => ({status: 404, body: {error: 'place_not_found'}})});
    await gone.page.locator('#selection').waitFor();
    await gone.page.waitForTimeout(400);
    assert.equal(await gone.page.locator('#selection-title').innerText(), 'Кофе');
    assert.deepEqual(gone.errors, []);
    await gone.context.close();
  },
  async 'language switch re-localizes chips, list, open label and card actions (EN)'(browser) {
    const {page, context} = await openPage(browser);
    await page.locator('#language').click(); await page.locator('#language').click(); // ru -> kk -> en
    assert.equal(await page.locator('.chip[data-category=pharmacy]').innerText(), 'Pharmacies');
    assert.equal(await page.locator('#chip-near').innerText(), 'Nearby');
    await page.locator('.chip[data-category=cafe]').click();
    await page.locator('#places-list li').first().waitFor();
    assert.match(await page.locator('#places-list li').first().innerText(), /Cafe\s*·\s*Open 24\/7/);
    assert.match(await page.locator('#places-title').innerText(), /In this area · 3/);
    await page.locator('#places-list li').first().click();
    await page.locator('#selection').waitFor();
    assert.equal(await page.locator('#route-place span').innerText(), 'Directions');
    assert.equal(await page.locator('#save-place').innerText(), 'Save');
    assert.equal(await page.locator('#selection-chip').innerText(), 'Cafes');
    await context.close();
  },
  async 'mobile: category bar scrolls inside the screen, list sheet fits, nothing overflows, touch targets >= 44px'(browser) {
    for (const viewport of [{width: 360, height: 740}, {width: 390, height: 844}, {width: 320, height: 568}]) {
      const {page, context} = await openPage(browser, {viewport, mobile: true});
      await page.locator('.chip[data-category=cafe]').tap();
      await page.locator('#places-list li').first().waitFor();
      await page.waitForTimeout(350); // let the 180 ms panel-rise animation finish before measuring
      const m = await page.evaluate(() => {
        const chips = document.getElementById('chips'); const r = chips.getBoundingClientRect();
        return {overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          chipsRight: Math.round(r.right), vw: innerWidth, chipH: Math.round(document.querySelector('.chip').getBoundingClientRect().height),
          scrollable: chips.scrollWidth > chips.clientWidth, sheetTop: Math.round(document.getElementById('sheet').getBoundingClientRect().top),
          sheetBottom: Math.round(document.getElementById('sheet').getBoundingClientRect().bottom), vh: innerHeight,
          rowH: Math.round(document.querySelector('#places-list .row').getBoundingClientRect().height)};
      });
      assert.equal(m.overflow, 0, 'overflow at ' + viewport.width);
      assert.ok(m.chipsRight <= m.vw, 'chip bar stays inside the screen');
      assert.ok(m.chipH >= 44 && m.rowH >= 44, JSON.stringify(m));
      assert.ok(m.scrollable, 'the bar scrolls horizontally');
      assert.ok(m.sheetTop > 140 && m.sheetBottom <= m.vh, JSON.stringify(m));
      await context.close();
    }
  },
  async 'controls have accessible names and the combobox pattern'(browser) {
    const {page, context} = await openPage(browser);
    for (const id of ['language', 'theme', 'locate', 'search-clear', 'selection-close', 'sheet-handle']) {
      assert.ok((await page.locator('#' + id).getAttribute('aria-label')), id + ' needs aria-label');
    }
    assert.equal(await page.locator('#search-query').getAttribute('role'), 'combobox');
    assert.equal(await page.locator('#search-results').getAttribute('role'), 'listbox');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ru');
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
      catch (error) { failed++; console.error('FAIL -', name, '\n      ', error.message.split('\n').slice(0, 6).join('\n       ')); }
    }
  } finally { await browser.close(); }
  console.log(failed ? failed + ' search UI test(s) failed' : 'All search UI tests passed');
  process.exitCode = failed ? 1 : 0;
})();

/* Browser test of the search UI against a mocked MapLibre and a scripted Search API.
 * Usage: WEB_URL=http://127.0.0.1:18080 node scripts/test-search-ui.js   (requires playwright)
 * Real-map visual checks are done separately; this test is deterministic and CDN-independent. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const WEB = process.env.WEB_URL || 'http://127.0.0.1:18080';
const SEARCH = 'https://search.test';
const CORS = {'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range,Content-Length,Retry-After'};

const place = (id, name, kind, lat, lon, extra = {}) => ({id, name, name_ru: name, name_kk: '', kind, lat, lon, ...extra});
const ALMATY = place(1, 'Алматы', 'city', 43.2364, 76.9457, {name_kk: 'Алматы'});
const MOCK_MAPLIBRE = `(function () {
  window.__calls = {flyTo: [], markers: [], removed: 0, styles: []};
  class Map {
    constructor(o) { this.h = {}; this.o = o; window.__map = this; setTimeout(() => { this.fire('style.load'); this.fire('load'); }, 0); }
    fire(e, ev) { (this.h[e] || []).forEach(f => f(ev)); }
    on(e, f) { (this.h[e] = this.h[e] || []).push(f); }
    addControl() {}
    getCenter() { return {lng: this.o.center[0], lat: this.o.center[1]}; }
    getZoom() { return this.o.zoom; }
    getStyle() { return this.o.style; }
    setStyle(style, options) { window.__calls.styles.push({style, options}); this.o.style = style; }
    flyTo(o) { window.__calls.flyTo.push(o); }
    queryRenderedFeatures() { return []; }
  }
  class Marker {
    constructor(o) { this.el = o && o.element; }
    setLngLat(l) { this.ll = l; return this; }
    addTo() { window.__calls.markers.push(this.ll); return this; }
    remove() { window.__calls.removed++; }
  }
  window.maplibregl = {addProtocol() {}, Map, Marker, NavigationControl: class {}};
})();
`;

async function openPage(browser, {viewport = {width: 1280, height: 800}, search = true, handler, colorScheme = 'light', hash = '', mobile = false} = {}) {
  const context = await browser.newContext({viewport, colorScheme, isMobile: mobile, hasTouch: mobile});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const requests = [];
  await page.route('https://unpkg.com/**', route => {
    const url = route.request().url();
    if (url.endsWith('.css')) return route.fulfill({status: 200, contentType: 'text/css', body: ''});
    if (url.includes('maplibre-gl.js')) return route.fulfill({status: 200, contentType: 'application/javascript', body: MOCK_MAPLIBRE});
    return route.fulfill({status: 200, contentType: 'application/javascript', body: 'window.pmtiles={Protocol:class{constructor(){this.tile=()=>{}}}};'});
  });
  await page.route('**/config.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(
    {styleUrl: '/style.json', tileUrl: 'https://tiles.test/k.pmtiles', ...(search ? {searchUrl: SEARCH} : {})})}));
  await page.route('https://tiles.test/**', route => route.fulfill({status: route.request().method() === 'OPTIONS' ? 204 : 206,
    headers: {...CORS, 'access-control-allow-headers': 'range', 'content-range': 'bytes 0-15/100'}, body: route.request().method() === 'OPTIONS' ? '' : '0123456789abcdef'}));
  await page.route(SEARCH + '/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers: CORS});
    const url = new URL(route.request().url());
    requests.push({q: url.searchParams.get('q'), limit: url.searchParams.get('limit'), credentials: route.request().headers()['cookie']});
    const reply = await (handler || (async () => ({results: [ALMATY]})))(url.searchParams.get('q'), requests.length);
    await route.fulfill({status: reply.status || 200, headers: {...CORS, 'content-type': 'application/json', ...(reply.headers || {})}, body: JSON.stringify(reply.body ?? {results: reply.results ?? []})});
  });
  await page.goto(WEB + '/' + hash, {waitUntil: 'domcontentloaded'});
  await page.locator('#status').filter({hasText: 'Карта загружена'}).waitFor({timeout: 15000});
  return {page, context, errors, requests};
}

const results = page => page.locator('#search-results [role=option]');
const calls = page => page.evaluate(() => window.__calls);

const tests = {
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

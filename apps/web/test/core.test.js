'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

const ok = results => ({ok: true, status: 200, headers: new Headers(), json: async () => ({results})});
const status = (code, headers = {}) => ({ok: false, status: code, headers: new Headers(headers), json: async () => ({})});
const place = (o = {}) => ({id: 1, name: 'Алматы', name_ru: 'Алматы', name_kk: 'Алматы', kind: 'city', lat: 43.2, lon: 76.9, ...o});
const client = (fetchImpl, extra = {}) => core.createSearchClient({
  baseUrl: 'https://s.test', fetchImpl, sleep: async () => {}, ...extra,
});

test('normalizes queries and enforces length limits', () => {
  assert.equal(core.normalizeQuery('  Алма   ты '), 'Алма ты');
  assert.equal(core.isSearchable('a'), false);
  assert.equal(core.isSearchable('ab'), true);
  assert.equal(core.isSearchable('a'.repeat(101)), false);
});

test('builds an encoded request and maps valid places only', async () => {
  const urls = [];
  const c = client(async url => { urls.push(url); return ok([place(), {lat: 'x', lon: 1, name: 'bad'}, null, place({lat: 99})]); });
  const results = await c.search('Қазақстан & co', {limit: 5});
  assert.equal(results.length, 1);
  assert.equal(urls[0], 'https://s.test/v1/search?q=%D2%9A%D0%B0%D0%B7%D0%B0%D2%9B%D1%81%D1%82%D0%B0%D0%BD%20%26%20co&limit=5');
});

test('keeps the API locality of address rows as plain text and ignores non-strings', async () => {
  const c = client(async () => ok([place({locality: 'Алматы'}), place({locality: 42}), place({locality: 'x'.repeat(200)})]));
  const [a, b, long] = await c.search('Абая 150');
  assert.equal(a.locality, 'Алматы');
  assert.equal(b.locality, '');
  assert.equal(long.locality.length, 80);
});

test('sends language and rounded map centre as ranking hints; cache is keyed by them', async () => {
  const urls = [];
  const c = client(async url => { urls.push(url); return ok([place()]); });
  await c.search('Алматы', {lang: 'kk', center: {lat: 43.23891, lng: 76.94512}});
  assert.match(urls[0], /&lang=kk&lat=43\.24&lon=76\.95$/);
  await c.search('Алматы', {lang: 'kk', center: {lat: 43.23891, lng: 76.94512}});
  assert.equal(urls.length, 1, 'same hints are cached');
  await c.search('Алматы', {lang: 'en'});
  assert.equal(urls.length, 2);
  assert.doesNotMatch(urls[1], /lat=|lon=/);
  await c.search('Алматы', {lang: 'xx', center: {lat: NaN, lng: 1}});
  assert.doesNotMatch(urls[2], /lang=|lat=/, 'invalid hints are dropped, never sent');
});

test('rejects too-short queries without a network call and requires configuration', async () => {
  let calls = 0;
  const c = client(async () => { calls++; return ok([]); });
  await assert.rejects(c.search('a'), {code: 'bad_request'});
  assert.equal(calls, 0);
  await assert.rejects(core.createSearchClient({baseUrl: '', fetchImpl: async () => ok([])}).search('ab'), {code: 'not_configured'});
});

test('retries one transient 503 then succeeds; does not retry 400', async () => {
  let calls = 0;
  const flaky = client(async () => (++calls === 1 ? status(503) : ok([place()])));
  assert.equal((await flaky.search('Алматы')).length, 1);
  assert.equal(calls, 2);
  calls = 0;
  const bad = client(async () => { calls++; return status(400); });
  await assert.rejects(bad.search('Алматы'), {code: 'bad_request'});
  assert.equal(calls, 1);
});

test('gives up after bounded retries on persistent 5xx and network errors', async () => {
  let calls = 0;
  await assert.rejects(client(async () => { calls++; return status(500); }).search('Алматы'), {code: 'unavailable'});
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(client(async () => { calls++; throw new TypeError('fetch failed'); }).search('Алматы'), {code: 'network'});
  assert.equal(calls, 2);
});

test('surfaces 429 with capped Retry-After and never retries it', async () => {
  let calls = 0;
  const c = client(async () => { calls++; return status(429, {'Retry-After': '9999'}); });
  await assert.rejects(c.search('Алматы'), e => e.code === 'rate_limited' && e.retryAfter === 120);
  assert.equal(calls, 1);
  const d = client(async () => status(429));
  await assert.rejects(d.search('Алматы'), e => e.retryAfter === 10);
});

test('times out slow requests and reports slow start via onSlow', async () => {
  let slow = 0;
  const hang = (url, {signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), {name: 'AbortError'}))));
  const c = client(hang, {timeoutMs: 60, wakeAfterMs: 20, retries: 0});
  await assert.rejects(c.search('Алматы', {onSlow: () => slow++}), {code: 'timeout'});
  assert.equal(slow, 1);
});

test('abort signal cancels the request and is not retried', async () => {
  let calls = 0;
  const hang = (url, {signal}) => { calls++; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), {name: 'AbortError'})))); };
  const c = client(hang, {timeoutMs: 5000});
  const controller = new AbortController();
  const pending = c.search('Алматы', {signal: controller.signal});
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, {code: 'aborted'});
  assert.equal(calls, 1);
});

test('rejects malformed JSON bodies', async () => {
  const c = client(async () => ({ok: true, status: 200, headers: new Headers(), json: async () => ({results: 'nope'})}));
  await assert.rejects(c.search('Алматы'), {code: 'invalid_response'});
});

test('caches identical queries within TTL and expires them', async () => {
  let calls = 0, time = 0;
  const c = client(async () => { calls++; return ok([place()]); }, {now: () => time, cacheTtlMs: 1000});
  await c.search('Алматы'); await c.search('  алматы '); 
  assert.equal(calls, 1);
  time = 5000;
  await c.search('Алматы');
  assert.equal(calls, 2);
});

test('display names fall back to canonical name and never invent values', () => {
  const p = core.validPlace(place({name: 'Almaty', name_ru: '', name_kk: ''}));
  assert.equal(core.displayName(p, 'kk'), 'Almaty');
  assert.equal(core.displayName(core.validPlace(place({name: 'A', name_ru: 'Р', name_kk: 'К'})), 'ru'), 'Р');
  assert.equal(core.displayName(core.validPlace(place({name: 'A', name_ru: 'Р', name_kk: 'К'})), 'kk'), 'К');
  assert.equal(core.displayName(core.validPlace(place({name: 'A', name_ru: 'Р', name_kk: 'К'})), 'en'), 'A');
  assert.equal(core.displayName(core.validPlace(place({name: 'А', name_en: 'Almaty'})), 'en'), 'Almaty');
});

test('kind labels are localized with a neutral fallback for unknown OSM keys', () => {
  assert.equal(core.kindLabel('city', 'ru'), 'Город');
  assert.equal(core.kindLabel('city', 'kk'), 'Қала');
  assert.equal(core.kindLabel('city', 'en'), 'City');
  assert.equal(core.kindLabel('country', 'ru'), 'Страна');
  assert.equal(core.kindLabel('country', 'en'), 'Country');
  assert.equal(core.kindLabel('weird_tag', 'en'), 'Place');
  assert.ok(core.zoomForKind('city') < core.zoomForKind('address'));
});

test('every UI string exists in all languages', () => {
  const keys = Object.keys(core.STRINGS.ru);
  for (const lang of ['kk', 'en']) assert.deepEqual(Object.keys(core.STRINGS[lang]).sort(), keys.slice().sort(), lang);
  assert.match(core.t('ru', 'rateLimited', {n: 7}), /7/);
});

test('config URL parsing accepts https and only localhost over http', () => {
  assert.equal(core.parseConfigUrl('https://a.example/x/'), 'https://a.example/x');
  assert.equal(core.parseConfigUrl('http://evil.example', true), null);
  assert.equal(core.parseConfigUrl('http://localhost:8081', true), 'http://localhost:8081');
  assert.equal(core.parseConfigUrl('http://localhost:8081', false), null);
  assert.equal(core.parseConfigUrl('javascript:alert(1)', true), null);
});

test('place hash round-trips and rejects invalid input', () => {
  const h = core.buildPlaceHash(43.23639, 76.94573, 'Алматы <b>');
  assert.deepEqual(core.parsePlaceHash(h), {lat: 43.23639, lng: 76.94573, name: 'Алматы <b>', poi: null, route: null});
  const withPoi = core.buildPlaceHash(43.2, 76.9, 'Кафе', 'n123');
  assert.equal(core.parsePlaceHash(withPoi).poi, 'n123');
  assert.equal(core.parsePlaceHash('#lat=1&lng=2&poi=n1%27%20OR%201').poi, null, 'invalid poi ids are ignored');
  assert.equal(core.parsePlaceHash('#lat=999&lng=1'), null);
  assert.equal(core.parsePlaceHash('#lat=abc&lng=1'), null);
  assert.equal(core.parsePlaceHash(''), null);
});

// ---- Places & POI ---------------------------------------------------------------------------------------------------
const poi = (o = {}) => ({id: 'n10', name: 'Кофейня', name_ru: null, name_kk: null, name_en: null, category: 'cafe', subtype: 'cafe',
  lat: 43.24, lon: 76.95, address: 'Абая 1', phone: '+7 727 111-22-33', website: 'https://alpha.example.kz', hours: 'Mo-Su 09:00-21:00',
  brand: null, ...o});
const okPlaces = places => ({ok: true, status: 200, headers: new Headers(), json: async () => ({places, truncated: false, count: places.length})});
const at = iso => new Date(iso); // Almaty is UTC+5: 04:00Z = 09:00 local

test('places client builds viewport and nearby URLs with rounded, validated parameters', async () => {
  const urls = [];
  const c = core.createPlacesClient({baseUrl: 'https://s.test', fetchImpl: async url => { urls.push(url); return okPlaces([poi()]); }, sleep: async () => {}});
  const r = await c.viewport({bbox: {west: 76.9, south: 43.2, east: 77.0, north: 43.3}, categories: ['cafe', 'nope', 'pharmacy'], center: {lat: 43.2501, lng: 76.9499}});
  assert.equal(urls[0], 'https://s.test/v1/places?bbox=76.9000,43.2000,77.0000,43.3000&limit=150&category=cafe,pharmacy&lat=43.250&lon=76.950');
  assert.equal(r.places.length, 1);
  await c.nearby({lat: 43.238912, lon: 76.889709, radius: 1500.4, categories: []});
  assert.equal(urls[1], 'https://s.test/v1/places?lat=43.239&lon=76.890&radius=1500&limit=60', 'position is rounded to ~100 m');
  await c.viewport({bbox: {west: 76.9, south: 43.2, east: 77.0, north: 43.3}, categories: ['cafe', 'pharmacy'], center: {lat: 43.2501, lng: 76.9499}});
  assert.equal(urls.length, 2, 'identical viewport requests are cached');
});

test('places client rejects malformed items and bad ids; maps errors', async () => {
  const bad = [poi({category: 'weapons'}), poi({lat: 999}), {category: 'cafe'}, null, poi({website: 'javascript:alert(1)'})];
  const c = core.createPlacesClient({baseUrl: 'https://s.test', fetchImpl: async () => okPlaces(bad), sleep: async () => {}});
  const {places} = await c.nearby({lat: 1, lon: 1});
  assert.equal(places.length, 1, 'only the item with a dangerous website survives, with the website removed');
  assert.equal(places[0].website, null);
  await assert.rejects(c.details("n1' OR 1=1"), {code: 'bad_request'});
  const notFound = core.createPlacesClient({baseUrl: 'https://s.test', fetchImpl: async () => ({ok: false, status: 404, headers: new Headers(), json: async () => ({})})});
  await assert.rejects(notFound.details('n5'), {code: 'not_found'});
  await assert.rejects(core.createPlacesClient({baseUrl: ''}).viewport({bbox: {west: 1, south: 1, east: 2, north: 2}}), {code: 'not_configured'});
  const limited = core.createPlacesClient({baseUrl: 'https://s.test', fetchImpl: async () => ({ok: false, status: 429, headers: new Headers({'Retry-After': '7'}), json: async () => ({})})});
  await assert.rejects(limited.nearby({lat: 1, lon: 1}), e => e.code === 'rate_limited' && e.retryAfter === 7);
});

test('website and phone sanitizers (defence in depth)', () => {
  assert.equal(core.safeWebsite('https://example.kz/a?b=1'), 'https://example.kz/a?b=1');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.kz', 'https://u:p@x.kz', '//x.kz', 'x.kz', '', null, 'https://' + 'a'.repeat(400)]) {
    assert.equal(core.safeWebsite(bad), null, String(bad));
  }
  assert.equal(core.telHref('+7 (727) 111-22-33; +7 701 000 00 00'), 'tel:+77271112233');
  assert.equal(core.telHref('8 7172 22 22 22'), 'tel:87172222222');
  for (const bad of ['', 'call', '<b>1234567</b>', '12', null]) assert.equal(core.telHref(bad), null, String(bad));
});

test('place titles never invent names and categories have labels in every language', () => {
  const atm = core.validPoi(poi({name: null, category: 'bank', subtype: 'atm'}));
  assert.equal(core.poiTitle(atm, 'ru'), 'Банкомат', 'unnamed ATM is shown by its kind, not with an invented name');
  assert.equal(core.poiTitle(core.validPoi(poi({name: null, category: 'cafe', subtype: 'exotic_tag'})), 'en'), 'Cafes', 'unknown subtype falls back to the category');
  assert.equal(core.poiTitle(core.validPoi(poi({name: null, category: 'parking', subtype: 'parking'})), 'en'), 'Parking');
  const named = core.validPoi(poi({name: 'Alpha', name_ru: 'Альфа', name_kk: 'Альфа қ.'}));
  assert.deepEqual(['ru', 'kk', 'en'].map(l => core.poiTitle(named, l)), ['Альфа', 'Альфа қ.', 'Alpha']);
  for (const id of core.CATEGORIES) {
    for (const lang of ['ru', 'kk', 'en']) assert.ok(core.categoryLabel(id, lang).length > 1, id + lang);
    assert.match(core.CATEGORY_COLORS[id], /^#[0-9a-f]{6}$/);
  }
  assert.equal(new Set(Object.values(core.CATEGORY_COLORS)).size, core.CATEGORIES.length, 'every category has its own colour');
});

test('distance formatting and external route link', () => {
  assert.equal(core.formatDistance(0, 'ru'), '0 м');
  assert.equal(core.formatDistance(347, 'ru'), '350 м');
  assert.equal(core.formatDistance(1234, 'en'), '1.2 km');
  assert.equal(core.formatDistance(15500, 'kk'), '16 км');
  assert.equal(core.formatDistance(NaN, 'ru'), '');
  assert.equal(core.routeUrl, undefined, 'there is no external-map directions link any more');
  for (const lang of ['ru', 'kk', 'en']) for (const [key, value] of Object.entries(core.STRINGS?.[lang] || {})) assert.ok(!/openstreetmap\.org\/directions/i.test(String(value)), key);
});

test('opening hours: open/closed/until/next, 24/7 and weekly wrap', () => {
  const h = 'Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off';
  // Almaty = UTC+5. 2026-11-23 is a Monday.
  assert.deepEqual(core.openStatus(h, at('2026-11-23T04:00:00Z')), {state: 'open', allDay: false, until: '18:00'});      // Mon 09:00
  assert.deepEqual(core.openStatus(h, at('2026-11-23T03:59:00Z')).next, {offset: 0, time: '09:00', day: 0});              // Mon 08:59
  assert.equal(core.openStatus(h, at('2026-11-23T13:00:00Z')).state, 'closed');                                            // Mon 18:00 sharp: closed
  assert.equal(core.openStatus(h, at('2026-11-21T07:00:00Z')).until, '14:00');                                             // Sat 12:00
  const satEvening = core.openStatus(h, at('2026-11-21T10:00:00Z'));                                                       // Sat 15:00
  assert.deepEqual([satEvening.state, satEvening.next.offset, satEvening.next.day, satEvening.next.time], ['closed', 2, 0, '09:00']);
  assert.equal(core.openStatus(h, at('2026-11-22T07:00:00Z')).state, 'closed');                                            // Sunday
  assert.deepEqual(core.openStatus('24/7', at('2026-11-22T07:00:00Z')), {state: 'open', allDay: true});
  assert.equal(core.openStatus('Sa-Mo 10:00-12:00', at('2026-11-22T06:00:00Z')).state, 'open', 'Sa-Mo wraps over Sunday (Sun 11:00)');
  assert.equal(core.openStatus('Sa-Mo 10:00-12:00', at('2026-11-24T06:00:00Z')).state, 'closed', 'Tuesday is outside Sa-Mo');
});

test('opening hours: overnight ranges, several ranges per day and rule overrides', () => {
  const night = 'Mo-Su 22:00-02:00';
  assert.deepEqual(core.openStatus(night, at('2026-11-23T20:00:00Z')), {state: 'open', allDay: false, until: '02:00'});     // Tue 01:00 (spill from Mon)
  assert.deepEqual(core.openStatus(night, at('2026-11-23T18:00:00Z')).state, 'open');                                       // Mon 23:00
  assert.deepEqual(core.openStatus(night, at('2026-11-24T07:00:00Z')).next, {offset: 0, time: '22:00', day: 1});           // Tue 12:00
  const lunch = 'Mo-Fr 09:00-13:00,14:00-18:00';
  assert.deepEqual(core.openStatus(lunch, at('2026-11-23T08:30:00Z')).next, {offset: 0, time: '14:00', day: 0});           // Mon 13:30
  assert.equal(core.openStatus(lunch, at('2026-11-23T10:00:00Z')).until, '18:00');                                          // Mon 15:00
  const override = 'Mo-Su 09:00-21:00; Fr 10:00-14:00';
  assert.equal(core.openStatus(override, at('2026-11-27T15:00:00Z')).state, 'closed', 'later rule overrides Friday (Fri 20:00)');
  assert.equal(core.openStatus(override, at('2026-11-28T15:00:00Z')).state, 'open', 'Saturday keeps the general rule');
  assert.equal(core.openStatus('Mo-Fr 09:00-24:00', at('2026-11-23T18:30:00Z')).until, '00:00');
});

test('opening hours: real-world variants (PH with same hours, spaces, comma between rules) are understood', () => {
  const mon = at('2026-11-23T05:00:00Z'); // Mon 10:00 Almaty
  assert.equal(core.openStatus('Mo-Su,PH 09:00-18:00', mon).until, '18:00');
  assert.equal(core.openStatus('PH,Mo-Su 09:00-18:00', mon).until, '18:00');
  assert.equal(core.openStatus('Mo-Fr 09:00 - 18:00', mon).until, '18:00');
  assert.equal(core.openStatus('Mo-Fr 09:00-18:00, Sa-Su 10:00-14:00', mon).until, '18:00');
  assert.equal(core.openStatus('Mo-Fr 09:00-18:00, Sa-Su 10:00-14:00', at('2026-11-22T06:00:00Z')).until, '14:00'); // Sun 11:00
  assert.equal(core.openStatus('Mo, We-Fr 09:00-18:00; Sa, Su 10:00-14:00', mon).until, '18:00');
  assert.equal(core.openStatus('Mo, We-Fr 09:00-18:00; Sa, Su 10:00-14:00', at('2026-11-24T05:00:00Z')).state, 'closed'); // Tue
  assert.equal(core.openStatus('Mo-Th 11:00-24:00; Fr-Sa 11:00-01:00; Su 12:00-24:00', at('2026-11-27T19:30:00Z')).until, '01:00'); // Sat 00:30 spill
});

test('opening hours: holiday rules that change the schedule stay unknown', () => {
  for (const text of ['Mo-Su 09:00-18:00; PH off', 'PH off', 'Mo-Fr 09:00-18:00; PH 10:00-14:00', 'Mo-Su,PH off']) {
    assert.equal(core.parseOpeningHours(text), null, text);
  }
});

test('opening hours: anything not understood is unknown, never guessed', () => {
  for (const text of ['Mo-Fr 09:00-18:00; PH off', 'sunrise-sunset', 'Mo-Fr 09:00-18:00 "by appointment"', 'Jan-Mar Mo 09:00-10:00',
    'Mo[1] 09:00-10:00', 'Mo-Fr 09:00-18:00+', 'week 1-10 Mo 09:00-10:00', 'garbage', '', '   ', null, undefined, 42,
    '09:00-25:00', '25:00-26:00', '09:60-10:00', 'Mo-Xx 09:00-10:00', '24:00-24:30']) {
    assert.equal(core.parseOpeningHours(text), null, String(text));
    assert.equal(core.openStatus(text, at('2026-11-23T04:00:00Z')), null, String(text));
    assert.equal(core.openLabel(text, 'ru', at('2026-11-23T04:00:00Z')), null, String(text));
    assert.equal(core.hoursTable(text, 'ru'), null, String(text));
  }
});

test('opening hours labels and weekly table are localized', () => {
  const h = 'Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off';
  assert.deepEqual(core.openLabel(h, 'ru', at('2026-11-23T04:00:00Z')), {state: 'open', label: 'Открыто · до 18:00'});
  assert.deepEqual(core.openLabel(h, 'en', at('2026-11-23T04:00:00Z')), {state: 'open', label: 'Open · until 18:00'});
  assert.equal(core.openLabel(h, 'kk', at('2026-11-23T04:00:00Z')).label, 'Ашық · 18:00 дейін');
  assert.equal(core.openLabel(h, 'ru', at('2026-11-23T03:00:00Z')).label, 'Закрыто · откроется в 09:00');
  assert.equal(core.openLabel(h, 'ru', at('2026-11-21T10:00:00Z')).label, 'Закрыто · откроется Пн в 09:00');
  assert.equal(core.openLabel('24/7', 'ru').label, 'Круглосуточно');
  const table = core.hoursTable(h, 'en');
  assert.deepEqual([table[0], table[5], table[6]], [{day: 'Mon', text: '09:00–18:00'}, {day: 'Sat', text: '10:00–14:00'}, {day: 'Sun', text: null}]);
});

test('favorites: toggle, key by osm id or coordinates, cap and validation of persisted data', () => {
  const a = core.validPoi(poi()), b = core.validPoi(poi({id: null, lat: 1, lon: 2}));
  let r = core.toggleFavorite([], a);
  assert.equal(r.saved, true);
  assert.equal(core.isFavorite(r.list, core.validPoi(poi({name: 'renamed'}))), true, 'same osm id = same favorite');
  r = core.toggleFavorite(core.toggleFavorite(r.list, b).list, a);
  assert.deepEqual([r.saved, r.list.length], [false, 1]);
  assert.equal(r.list[0].id, null);
  assert.deepEqual(Object.keys(r.list[0]).sort(), ['address', 'category', 'id', 'lat', 'lon', 'name', 'nameEn', 'nameKk', 'nameRu', 'subtype'], 'only display fields are stored');
  let big = [];
  for (let i = 0; i < 250; i++) big = core.toggleFavorite(big, core.validPoi(poi({id: 'n' + (i + 1)}))).list;
  assert.equal(big.length, 200);
  assert.equal(big[0].id, 'n250', 'newest first');
  const restored = core.parseFavorites(JSON.stringify(big.slice(0, 3)));
  assert.deepEqual(restored.map(x => x.id), ['n250', 'n249', 'n248']);
  for (const junk of ['not json', '{}', '[1,2,null]', '[{"category":"cafe"}]', null, '[{"lat":1,"lon":2,"category":"weapons"}]']) assert.deepEqual(core.parseFavorites(junk), [], String(junk));
  // plain points and search hits (no category) are valid favorites too
  const point = {id: null, name: 'Алматы', nameRu: null, nameKk: null, nameEn: 'Almaty', category: null, subtype: 'city', lat: 43.2, lon: 76.9, address: null};
  const toggled = core.toggleFavorite([], point);
  assert.deepEqual(core.parseFavorites(JSON.stringify(toggled.list)), toggled.list);
  assert.equal(core.favoriteTitle(point, 'en'), 'Almaty');
  assert.equal(core.favoriteTitle({...point, name: null, nameEn: null}, 'ru'), '43.20000, 76.90000', 'coordinates, never an invented name');
  assert.equal(core.favoriteTitle({...point, name: null, nameEn: null, category: 'parking', subtype: 'parking'}, 'ru'), 'Парковка');
});

test('every new UI string exists in all languages', () => {
  const keys = Object.keys(core.STRINGS.ru);
  for (const lang of ['kk', 'en']) assert.deepEqual(Object.keys(core.STRINGS[lang]).sort(), keys.slice().sort(), lang);
  for (const key of ['nearMe', 'openNow', 'route', 'save', 'favorites']) assert.ok(keys.includes(key), key);
});

// ---- routing client ----------------------------------------------------------------------------------------
const routeBody = (o = {}) => ({
  mode: 'car', distance_m: 3510, duration_s: 312, geometry: {type: 'LineString', coordinates: [[76.9456, 43.238], [76.95, 43.25], [76.9567, 43.261]]},
  bbox: [76.9456, 43.238, 76.9567, 43.261], instruction_language: 'en',
  steps: [{instruction: 'Head north.', type: 1, street: 'Dostyk', distance_m: 3200, duration_s: 280, location: [76.9456, 43.238]}], ...o,
});
const json = (code, body) => ({ok: code < 400, status: code, headers: new Headers(), json: async () => body});
const routes = fetchImpl => core.createRouteClient({baseUrl: 'https://r.test', fetchImpl, sleep: async () => {}});

test('route client builds a precise GET request, validates and normalizes the reply', async () => {
  const urls = [];
  const c = routes(async (url) => { urls.push(url); return json(200, routeBody()); });
  const route = await c.route({from: {lat: 43.23801234, lon: 76.945678}, to: {lat: 43.261, lon: 76.9567}, mode: 'bike', lang: 'kk'});
  assert.equal(urls[0], 'https://r.test/v1/route?from=43.23801,76.94568&to=43.26100,76.95670&mode=bike&lang=kk');
  assert.equal(route.distance, 3510);
  assert.equal(route.coordinates.length, 3);
  assert.equal(route.steps[0].street, 'Dostyk');
  assert.equal(route.narrationLang, 'en');
});

test('route client rejects malformed replies, bad input and missing configuration', async () => {
  const bad = [routeBody({mode: 'plane'}), routeBody({distance_m: -1}), routeBody({geometry: {type: 'Point', coordinates: [1, 2]}}),
    routeBody({geometry: {type: 'LineString', coordinates: [[76.9, 43.2]]}}), routeBody({geometry: {type: 'LineString', coordinates: [[76.9, 43.2], [999, 1]]}}), null, 'x'];
  for (const body of bad) {
    await assert.rejects(routes(async () => json(200, body)).route({from: {lat: 43, lon: 76}, to: {lat: 44, lon: 77}}), e => e.code === 'invalid_response', JSON.stringify(body).slice(0, 60));
  }
  const dirty = core.validRoute(routeBody({steps: [{instruction: 5, location: [1, 2]}, {instruction: 'ok', location: [999, 1]}, {instruction: 'good', location: [76.9, 43.2], street: 7}]}));
  assert.deepEqual(dirty.steps.map(s => [s.instruction, s.street]), [['good', '']]);
  const c = routes(async () => json(200, routeBody()));
  await assert.rejects(c.route({from: {lat: NaN, lon: 76}, to: {lat: 44, lon: 77}}), e => e.code === 'bad_request');
  await assert.rejects(c.route({from: {lat: 43, lon: 76}, to: {lat: 44, lon: 77}, mode: 'plane'}), e => e.code === 'bad_request');
  await assert.rejects(core.createRouteClient({baseUrl: ''}).route({from: {lat: 43, lon: 76}, to: {lat: 44, lon: 77}}), e => e.code === 'not_configured');
});

test('route client exposes the API error code and never retries', async () => {
  let calls = 0;
  for (const [code, error, expected] of [[400, 'outside_coverage', 'bad_request'], [404, 'no_route', 'not_found']]) {
    const c = routes(async () => { calls++; return json(code, {error}); });
    await assert.rejects(c.route({from: {lat: 43, lon: 76}, to: {lat: 44, lon: 77}}), e => e.code === expected && e.detail === error);
  }
  const down = routes(async () => { calls++; return json(502, {error: 'routing_unavailable'}); });
  await assert.rejects(down.route({from: {lat: 43, lon: 76}, to: {lat: 44, lon: 77}}), e => e.code === 'unavailable');
  assert.equal(calls, 3);  // one attempt each, no retry for routes
  const limited = routes(async () => ({ok: false, status: 429, headers: new Headers({'Retry-After': '7'}), json: async () => ({})}));
  await assert.rejects(limited.route({from: {lat: 43, lon: 76}, to: {lat: 44, lon: 77}}), e => e.code === 'rate_limited' && e.retryAfter === 7);
});

test('durations are formatted per language', () => {
  assert.equal(core.formatDuration(3900, 'ru'), '1 ч 5 мин');
  assert.equal(core.formatDuration(7200, 'en'), '2 h');
  assert.equal(core.formatDuration(700, 'en'), '12 min');
  assert.equal(core.formatDuration(10, 'kk'), '<1 мин');
  assert.equal(core.formatDuration(NaN, 'ru'), '');
  for (const lang of core.LANGS) for (const key of ['routeTitle', 'modeCar', 'routeNoRoute', 'routeOutside', 'routeNote', 'routeFailed']) assert.ok(core.t(lang, key), lang + key);
});

test('route replies carry validated alternatives and the data version', async () => {
  const alt = routeBody({distance_m: 4200, duration_s: 600});
  const c = routes(async (url) => json(200, routeBody({alternatives: [alt, {mode: 'car', distance_m: -5}, null], data_version: 'osm-261121'})));
  const route = await c.route({from: {lat: 43, lon: 76}, to: {lat: 44, lon: 77}, alternatives: true});
  assert.equal(route.alternatives.length, 1);  // malformed alternatives are dropped, not shown
  assert.equal(route.alternatives[0].distance, 4200);
  assert.deepEqual(route.alternatives[0].alternatives, []);
  assert.equal(route.dataVersion, 'osm-261121');
  const urls = [];
  await routes(async (url) => { urls.push(url); return json(200, routeBody()); }).route({from: {lat: 43, lon: 76}, to: {lat: 44, lon: 77}, alternatives: true});
  assert.match(urls[0], /&alternatives=1$/);
});

test('route deep links carry the destination and mode only (never a start position)', () => {
  const hash = core.buildPlaceHash(43.15944, 77.05757, 'Медеу', 'n4665144598', 'foot');
  assert.equal(hash, '#lat=43.15944&lng=77.05757&name=%D0%9C%D0%B5%D0%B4%D0%B5%D1%83&poi=n4665144598&route=foot');
  assert.deepEqual(core.parsePlaceHash(hash), {lat: 43.15944, lng: 77.05757, name: 'Медеу', poi: 'n4665144598', route: 'foot'});
  assert.equal(core.parsePlaceHash('#lat=43&lng=76&route=plane').route, null);
  assert.equal(core.parsePlaceHash('#lat=43&lng=76&route=car&from=43.2,76.9').route, 'car');
  assert.equal(core.buildPlaceHash(43, 76, '', null, 'plane'), '#lat=43.00000&lng=76.00000');
  assert.equal('from' in core.parsePlaceHash('#lat=43&lng=76&from=43.2,76.9'), false);
});

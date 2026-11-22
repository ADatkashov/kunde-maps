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
  assert.deepEqual(core.parsePlaceHash(h), {lat: 43.23639, lng: 76.94573, name: 'Алматы <b>'});
  assert.equal(core.parsePlaceHash('#lat=999&lng=1'), null);
  assert.equal(core.parsePlaceHash('#lat=abc&lng=1'), null);
  assert.equal(core.parsePlaceHash(''), null);
});

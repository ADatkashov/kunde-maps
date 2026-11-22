// Phase 5.5 shell logic: bottom-sheet snap points and gestures, search history, local settings, keyboard inset, units, strings, icons.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Shell = require('../shell.js');
const Icons = require('../icons.js');
const core = require('../core.js');
const nav = require('../nav.js');

const H = Shell.snapHeights({viewport: 844, topbar: 200, tabbar: 62, peek: 124});

test('snap heights are ordered, fit the screen and leave the top bar visible', () => {
  assert.ok(H.collapsed < H.half && H.half < H.full, JSON.stringify(H));
  assert.equal(H.collapsed, 124);
  assert.ok(H.full <= 844 - 200 - 62, 'full sheet stays below the search and category bar');
  const tiny = Shell.snapHeights({viewport: 480, topbar: 200, tabbar: 62, peek: 124});
  assert.ok(tiny.collapsed <= tiny.half && tiny.half <= tiny.full, 'tiny screens still have ordered snaps: ' + JSON.stringify(tiny));
  const keyboard = Shell.snapHeights({viewport: 300, topbar: 200, tabbar: 0, peek: 124});
  assert.ok(keyboard.full >= keyboard.collapsed, 'with the keyboard open the sheet never collapses below its peek');
});

test('release of a drag: nearest snap, flick moves one step, extremes clamp', () => {
  assert.equal(Shell.snapOnRelease(130, H, 0), 'collapsed');
  assert.equal(Shell.snapOnRelease(H.half + 5, H, 0), 'half');
  assert.equal(Shell.snapOnRelease(H.full - 10, H, 0), 'full');
  assert.equal(Shell.snapOnRelease(H.collapsed + 20, H, 0.9), 'half', 'a flick up from collapsed opens half way, not full');
  assert.equal(Shell.snapOnRelease(H.half + 20, H, 0.9), 'full');
  assert.equal(Shell.snapOnRelease(H.half - 20, H, -0.9), 'collapsed', 'a flick down from half collapses');
  assert.equal(Shell.snapOnRelease(H.full, H, 2), 'full');
  assert.equal(Shell.snapOnRelease(H.collapsed, H, -2), 'collapsed');
  assert.equal(Shell.clampHeight(5, H), H.collapsed);
  assert.equal(Shell.clampHeight(9999, H), H.full);
});

test('keyboard stepping through snap points', () => {
  assert.equal(Shell.stepSnap('collapsed', 1), 'half');
  assert.equal(Shell.stepSnap('half', 1), 'full');
  assert.equal(Shell.stepSnap('full', 1), 'full');
  assert.equal(Shell.stepSnap('full', -1), 'half');
  assert.equal(Shell.stepSnap('collapsed', -1), 'collapsed');
  assert.equal(Shell.stepSnap('bogus', 1), 'half');
});

test('search history: dedupes case-insensitively, caps, rejects junk, survives corrupt storage', () => {
  let list = [];
  list = Shell.addHistory(list, '  Байзакова   12 ');
  list = Shell.addHistory(list, 'Абая');
  list = Shell.addHistory(list, 'байзакова 12');
  assert.deepEqual(list, ['байзакова 12', 'Абая']);
  assert.deepEqual(Shell.addHistory(list, 'а'), list, 'one-character queries are not stored');
  assert.deepEqual(Shell.addHistory(list, 'x'.repeat(101)), list);
  for (let i = 0; i < 20; i++) list = Shell.addHistory(list, 'query ' + i);
  assert.equal(list.length, Shell.HISTORY_MAX);
  assert.equal(list[0], 'query 19');
  assert.deepEqual(Shell.parseHistory('{"oops":'), []);
  assert.deepEqual(Shell.parseHistory('{"a":1}'), []);
  assert.deepEqual(Shell.parseHistory(JSON.stringify(['ok query', 5, '', 'x', null])), ['ok query']);
  assert.deepEqual(Shell.parseHistory(null), []);
});

test('settings: defaults, validation, 3D never together with low-power', () => {
  assert.deepEqual(Shell.parseSettings(null), Shell.DEFAULT_SETTINGS);
  assert.deepEqual(Shell.parseSettings('garbage'), Shell.DEFAULT_SETTINGS);
  const s = Shell.parseSettings(JSON.stringify({history: false, lowPower: 'yes', units: 'furlongs', buildings3d: true, extra: 1}));
  assert.equal(s.history, false); assert.equal(s.lowPower, false, 'non-boolean ignored'); assert.equal(s.units, 'metric'); assert.equal(s.extra, undefined);
  assert.equal(Shell.buildingsEnabled({buildings3d: true, lowPower: false}), true);
  assert.equal(Shell.buildingsEnabled({buildings3d: true, lowPower: true}), false);
  assert.equal(Shell.buildingsEnabled({buildings3d: false, lowPower: false}), false);
  assert.equal(Shell.parseSettings('{"units":"imperial"}').units, 'imperial');
});

test('low-end device hint', () => {
  assert.equal(Shell.suggestLowPower({deviceMemory: 2, hardwareConcurrency: 8}), true);
  assert.equal(Shell.suggestLowPower({deviceMemory: 8, hardwareConcurrency: 2}), true);
  assert.equal(Shell.suggestLowPower({deviceMemory: 8, hardwareConcurrency: 8}), false);
  assert.equal(Shell.suggestLowPower({}), false, 'unknown hardware is not assumed to be weak');
  assert.equal(Shell.suggestLowPower(undefined), false);
});

test('virtual keyboard inset ignores browser chrome and needs a visual viewport', () => {
  assert.equal(Shell.keyboardInset(800, null), 0);
  assert.equal(Shell.keyboardInset(800, {height: 790, offsetTop: 0}), 0);
  assert.equal(Shell.keyboardInset(800, {height: 480, offsetTop: 0}), 320);
  assert.equal(Shell.keyboardInset(800, {height: 480, offsetTop: 20}), 300);
});

test('shell strings: RU, KK and EN define the same keys, none are empty, params are filled', () => {
  const keys = Object.keys(Shell.S.ru);
  for (const lang of ['kk', 'en']) {
    assert.deepEqual(Object.keys(Shell.S[lang]).sort(), keys.slice().sort(), lang + ' is missing or has extra keys');
  }
  for (const lang of Object.keys(Shell.S)) for (const [k, v] of Object.entries(Shell.S[lang])) assert.ok(v && v.trim(), lang + '.' + k + ' is empty');
  assert.match(Shell.shellT('en', 'locOk', {n: 12}), /12/);
  assert.equal(Shell.shellT('xx', 'tabSearch'), 'Поиск', 'unknown language falls back to Russian');
  assert.equal(Shell.shellT('en', 'nope'), 'nope');
  assert.deepEqual(Shell.TABS, ['search', 'route', 'navigator', 'favorites', 'profile']);
});

test('shell strings never promise features that do not exist', () => {
  const copy = JSON.parse(JSON.stringify(Shell.S));
  for (const lang of Object.keys(copy)) delete copy[lang].layerTrafficNote;   // the one place that says traffic is NOT available
  const all = JSON.stringify(copy).toLowerCase();
  for (const word of ['live traffic', 'пробки в реальном', 'голосов', 'voice search', 'sync', 'синхрониз']) assert.ok(!all.includes(word), 'promises ' + word);
  assert.match(Shell.shellT('en', 'layerTrafficNote'), /no verified source/i);
});

test('units: imperial display for the search and navigation formatters, metric by default', () => {
  assert.equal(core.getUnits(), 'metric');
  assert.equal(core.formatDistance(250, 'en'), '250 m');
  assert.equal(core.formatDistance(1500, 'en'), '1.5 km');
  core.setUnits('imperial'); nav.setNavUnits('imperial');
  try {
    assert.equal(core.formatDistance(50, 'en'), '160 ft');
    assert.equal(core.formatDistance(1609.344, 'en'), '1.0 mi');
    assert.equal(core.formatDistance(16093, 'en'), '10 mi');
    assert.match(core.formatDistance(100, 'ru'), /фт$/);
    assert.equal(nav.formatNavDistance(5000, 'en'), '3.1 mi');
    assert.match(nav.formatNavDistance(60, 'en'), /ft$/);
    core.setUnits('bogus');
    assert.equal(core.getUnits(), 'metric', 'unknown units fall back to metric');
  } finally { core.setUnits('metric'); nav.setNavUnits('metric'); }
  assert.equal(nav.formatNavDistance(5000, 'en'), '5 km');
});

test('icons: every shell icon and every Places category has a path; unknown names fall back to a pin', () => {
  for (const name of [...core.CATEGORIES, 'search', 'close', 'layers', 'plus', 'minus', 'locate', 'compass', 'route', 'car', 'walk', 'bike', 'bookmark', 'addPlace', 'navigator', 'user', 'moon', 'sun', 'more', 'clock']) {
    assert.ok(Icons.paths[name], 'missing icon ' + name);
  }
  assert.equal(Icons.get('does-not-exist'), Icons.paths.pin);
  assert.match(Icons.svg('car'), /^<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"/);
});

test('the page ships no third-party code and no inline scripts after the redesign', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!/(?:src|href)="(?:https?:)?\/\//.test(html), 'external resource in index.html');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html), 'inline script');
  for (const f of ['shell.js', 'icons.js', 'shell-ui.js']) assert.ok(html.includes('./' + f), f + ' is wired into index.html');
  const css = ['ui.css', 'shell.css', 'nav.css'].map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  assert.ok(!/@import|url\(\s*['"]?https?:/.test(css), 'CSS pulls remote resources');
});

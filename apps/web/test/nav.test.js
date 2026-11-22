// Navigation core tests: deterministic GPS tracks over a REAL Valhalla reply captured from the DEV routing API
// (test/fixtures/route-almaty-car.json, OpenStreetMap data, ODbL) plus synthetic geometry for matcher edge cases.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../core.js');
const nav = require('../nav.js');

const body = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'route-almaty-car.json'), 'utf8'));
const ROUTE = core.validRoute(body);
const T0 = 1_700_000_000_000;

// ---- harness ---------------------------------------------------------------------------------------------
function harness(opts = {}) {
  const clock = {t: T0};
  const timers = {list: new Map(), next: 1};
  const fakeTimers = {
    setInterval: (f, ms) => { const id = timers.next++; timers.list.set(id, {f, ms, kind: 'i'}); return id; },
    clearInterval: id => timers.list.delete(id),
    setTimeout: (f, ms) => { const id = timers.next++; timers.list.set(id, {f, ms, kind: 't', at: clock.t + ms}); return id; },
    clearTimeout: id => timers.list.delete(id),
  };
  const geo = {watchers: new Map(), next: 1, cleared: 0,
    watchPosition(ok, err, o) { const id = this.next++; this.watchers.set(id, {ok, err, o}); return id; },
    clearWatch(id) { this.watchers.delete(id); this.cleared++; }};
  const requests = [];
  const route = opts.route || ROUTE;
  const fetchRoute = opts.fetchRoute || (req => { requests.push(req); return new Promise((resolve, reject) => { req.resolve = resolve; req.reject = reject; }); });
  const updates = [], events = [];
  const session = nav.createSession({route, mode: opts.mode || 'car', lang: opts.lang || 'ru', geo: opts.geo === undefined ? geo : opts.geo, fetchRoute,
    now: () => clock.t, timers: fakeTimers, onUpdate: s => updates.push(s), onEvent: e => events.push(e), config: opts.config});
  const index = session.index;
  const pointAt = s => {
    const c = nav.clamp(s, 0, index.total);
    let i = 0; while (i < index.pts.length - 2 && index.cum[i + 1] < c) i++;
    const t = (c - index.cum[i]) / Math.max(index.cum[i + 1] - index.cum[i], 1e-9);
    return {lon: index.pts[i][0] + t * (index.pts[i + 1][0] - index.pts[i][0]), lat: index.pts[i][1] + t * (index.pts[i + 1][1] - index.pts[i][1]),
      bearing: nav.bearing(index.pts[i][1], index.pts[i][0], index.pts[i + 1][1], index.pts[i + 1][0])};
  };
  // a fix `s` metres along the route and `side` metres to the RIGHT of the direction of travel (negative: left)
  const fix = (s, {side = 0, acc = 8, dt = 1000, speed, heading, ts} = {}) => {
    clock.t += dt;
    const p = pointAt(s);
    const rad = (p.bearing + 90) * Math.PI / 180;   // perpendicular, to the right
    const lon = p.lon + side * Math.sin(rad) / (Math.cos(p.lat * Math.PI / 180) * 111194.9), lat = p.lat + side * Math.cos(rad) / 111194.9;
    return {coords: {latitude: lat, longitude: lon, accuracy: acc, speed: speed ?? null, heading: heading ?? null}, timestamp: ts ?? clock.t};
  };
  const feed = (...fixes) => fixes.forEach(f => session.handleFix(f));
  const drive = (from, to, step = 15, extra = {}) => { for (let s = from; s <= to; s += step) session.handleFix(fix(s, extra)); };
  // leaving the road the way a vehicle does: the lateral offset grows ~25 m per second (a sideways teleport would be a GPS jump)
  const deviate = (s0, n = 5, {dt = 1000, from = 45} = {}) => { for (let i = 0; i < n; i++) session.handleFix(fix(s0 + i * 8, {side: from + i * 25, dt})); };
  return {session, geo, clock, timers, requests, deviate, updates, events, index, fix, feed, drive, pointAt, last: () => session.snapshot()};
}
const flush = () => new Promise(r => setImmediate(r));

// ---- state machine ----------------------------------------------------------------------------------------
test('state machine: legal transitions only, terminal states only reset to IDLE', () => {
  const seen = [];
  const m = nav.createStateMachine((n, p) => seen.push(p + '>' + n));
  assert.equal(m.state, 'IDLE');
  assert.equal(m.go('ACTIVE'), false, 'IDLE cannot jump to ACTIVE');
  assert.equal(m.go('PREPARING'), true);
  assert.equal(m.go('ACTIVE'), true);
  assert.equal(m.go('REROUTING'), false, 'ACTIVE must pass through OFF_ROUTE');
  assert.equal(m.go('OFF_ROUTE'), true);
  assert.equal(m.go('REROUTING'), true);
  assert.equal(m.go('ARRIVED'), false, 'REROUTING cannot arrive directly');
  assert.equal(m.go('STOPPED'), true);
  for (const next of nav.STATES) if (next !== 'IDLE' && next !== 'STOPPED') assert.equal(m.go(next), false, 'STOPPED -> ' + next);
  assert.equal(m.go('IDLE'), true);
  assert.deepEqual(seen, ['IDLE>PREPARING', 'PREPARING>ACTIVE', 'ACTIVE>OFF_ROUTE', 'OFF_ROUTE>REROUTING', 'REROUTING>STOPPED', 'STOPPED>IDLE']);
  for (const s of nav.STATES) assert.ok(nav.TRANSITIONS[s], s + ' has a transition row');
});

// ---- geometry ---------------------------------------------------------------------------------------------
test('geo math: haversine, bearing, angle difference', () => {
  assert.ok(Math.abs(nav.haversine(0, 0, 0, 1) - 111195) < 50);
  assert.ok(Math.abs(nav.haversine(43.238, 76.945, 43.238, 76.945)) < 1e-6);
  assert.ok(Math.abs(nav.bearing(43, 76, 44, 76) - 0) < 0.01);
  assert.ok(Math.abs(nav.bearing(43, 76, 43, 77) - 90) < 0.5);
  assert.equal(nav.angleDiff(350, 10), 20);
  assert.equal(nav.angleDiff(0, 180), 180);
  assert.equal(nav.angleDiff(90, 90), 0);
});

test('route index: step positions are monotonic along the route, arrival sits at the end, ETA baseline is the API duration', () => {
  const h = harness();
  const {steps, total} = h.index;
  assert.ok(Math.abs(total - ROUTE.distance) < 60, `geometry ${total} vs api ${ROUTE.distance}`);
  assert.equal(steps.length, ROUTE.steps.length);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i].along >= steps[i - 1].along, 'monotonic step ' + i);
  assert.equal(steps[0].along, 0);
  assert.equal(steps[steps.length - 1].along, total);
  assert.ok(Math.abs(h.index.remainingSeconds(0) - ROUTE.duration) < 1);
  assert.equal(h.index.remainingSeconds(total), 0);
  let prev = Infinity;
  for (let s = 0; s <= total; s += 100) { const r = h.index.remainingSeconds(s); assert.ok(r <= prev + 1e-9); prev = r; }
});

test('projection picks the leg being travelled when the route passes the same place twice (self-crossing)', () => {
  // synthetic figure-eight geometry for the matcher only: east, north, west, south crossing the first leg, then on
  const pts = [[76.90, 43.20], [76.92, 43.20], [76.92, 43.22], [76.91, 43.22], [76.91, 43.19], [76.93, 43.19]];
  const index = nav.createRouteIndex({coordinates: pts, mode: 'car', distance: 0, duration: 100, steps: []});
  const crossing = {lat: 43.20, lon: 76.91};   // the route passes here on leg 1 (heading east) and on leg 4 (heading south)
  const firstPass = nav.projectPoint(index, crossing.lat, crossing.lon, 0, index.total, 90);
  const secondPass = nav.projectPoint(index, crossing.lat, crossing.lon, 0, index.total, 180);
  assert.ok(firstPass.along < 1800 && firstPass.lateral < 1, 'east-bound picks the first pass');
  assert.ok(secondPass.along > 5000 && secondPass.lateral < 1, 'south-bound picks the second pass: ' + secondPass.along);
  // the progress window keeps the second pass from being mistaken for the first when progress is already past the first
  const windowed = nav.projectPoint(index, crossing.lat, crossing.lon, 5000, 6000, null);
  assert.ok(windowed.along > 5000);
});

// ---- progress, maneuvers, ETA ------------------------------------------------------------------------------
test('driving the real route: ACTIVE, monotonic progress, maneuver switches at the corner, ETA shrinks', () => {
  const h = harness();
  h.session.start();
  assert.equal(h.last().state, 'PREPARING');
  assert.equal(h.geo.watchers.size, 1);
  assert.equal(h.geo.watchers.get(1).o.enableHighAccuracy, true);
  const corner = h.index.steps[1].along;
  const seen = {first: null, beforeTurn: null, afterTurn: null};
  let prevAlong = -1, prevRemaining = Infinity;
  for (let s = 0; s <= h.index.total - 40; s += 15) {
    h.session.handleFix(h.fix(s));
    const snap = h.last();
    assert.equal(snap.state, 'ACTIVE', 'state at ' + s);
    assert.ok(snap.progress.alongM >= prevAlong, 'monotonic along');
    assert.ok(snap.progress.remainingM <= prevRemaining + 1e-6);
    prevAlong = snap.progress.alongM; prevRemaining = snap.progress.remainingM;
    if (s === 0) seen.first = snap;
    if (s === Math.floor((corner - 300) / 15) * 15) seen.beforeTurn = snap;
    if (s === Math.ceil((corner + 60) / 15) * 15) seen.afterTurn = snap;
  }
  assert.equal(seen.first.maneuver.icon, 'depart');
  assert.equal(seen.beforeTurn.maneuver.type, 15, 'next maneuver is the left turn');
  assert.equal(seen.beforeTurn.maneuver.icon, 'left');
  assert.ok(Math.abs(seen.beforeTurn.maneuver.distanceM - 300) < 30, 'distance to turn ' + seen.beforeTurn.maneuver.distanceM);
  assert.equal(seen.beforeTurn.maneuver.text, 'Поверните налево');
  assert.equal(seen.beforeTurn.maneuver.street, 'Достық даңғылы');
  assert.equal(seen.afterTurn.maneuver.type, 10, 'after the turn the next maneuver is the right turn');
  const end = h.last();
  assert.ok(end.progress.fraction > 0.97);
  assert.ok(Math.abs(end.progress.etaMs - (h.clock.t + end.progress.remainingS * 1000)) < 1);
  assert.ok(seen.first.progress.remainingS > end.progress.remainingS);
  assert.ok(Math.abs(seen.first.progress.remainingS - ROUTE.duration) < 5, 'ETA baseline is the API duration');
  assert.ok(seen.first.progress.remainingM > 4000);
});

test('GPS noise (lateral jitter, stationary scatter) never moves progress backwards or triggers off-route', () => {
  const h = harness();
  h.session.start();
  const jitter = [4, -6, 9, -3, 7, -8, 2, 5, -9, 6];
  let prev = -1;
  for (let s = 100, i = 0; s < 900; s += 12, i++) {
    h.session.handleFix(h.fix(s + (i % 3 === 0 ? -6 : 3), {side: jitter[i % jitter.length], acc: 12}));
    const snap = h.last();
    assert.equal(snap.state, 'ACTIVE');
    assert.ok(snap.progress.alongM >= prev); prev = snap.progress.alongM;
  }
});

// ---- GPS filtering ----------------------------------------------------------------------------------------
test('stale and out-of-order fixes are dropped', () => {
  const h = harness();
  h.session.start();
  assert.equal(h.session.handleFix(h.fix(100)), true);
  const before = h.last().progress.alongM;
  assert.equal(h.session.handleFix(h.fix(300, {ts: h.clock.t - 30000, dt: 0})), false, 'older than 15 s');
  assert.equal(h.session.handleFix(h.fix(300, {ts: h.clock.t - 3000, dt: 0})), false, 'older than the last accepted fix');
  assert.equal(h.last().progress.alongM, before);
});

test('inaccurate fixes never move progress; three in a row show GPS_WEAK; a good fix recovers', () => {
  const h = harness();
  h.session.start();
  h.drive(0, 150);
  const before = h.last().progress.alongM;
  for (let i = 0; i < 3; i++) assert.equal(h.session.handleFix(h.fix(600 + i * 10, {acc: 250})), false);
  assert.equal(h.last().state, 'GPS_WEAK');
  assert.equal(h.last().gpsIssue, 'accuracy');
  assert.equal(h.last().progress.alongM, before);
  assert.equal(h.session.handleFix(h.fix(180)), true);
  assert.equal(h.last().state, 'ACTIVE');
  assert.equal(h.last().gpsIssue, null);
});

test('a single GPS jump is ignored; a consistent repeated jump (tunnel exit) is believed', () => {
  const h = harness();
  h.session.start();
  h.drive(0, 300);
  const before = h.last().progress.alongM;
  assert.equal(h.session.handleFix(h.fix(2500, {dt: 1000})), false, 'one outlier');
  assert.equal(h.last().state, 'ACTIVE');
  assert.equal(h.last().progress.alongM, before);
  h.drive(315, 345);                     // normal fixes resume: the outlier is forgotten
  assert.equal(h.last().state, 'ACTIVE');
  assert.ok(h.last().progress.alongM >= before);
  // teleport: three consistent fixes far ahead
  h.session.handleFix(h.fix(2500)); h.session.handleFix(h.fix(2502)); h.session.handleFix(h.fix(2505));
  assert.ok(h.last().progress.alongM > 2400, 'believed after 3: ' + h.last().progress.alongM);
  assert.equal(h.last().state, 'ACTIVE');
});

test('signal loss: no fixes for 8 s -> GPS_WEAK (no_signal), a fresh fix recovers', () => {
  const h = harness();
  h.session.start();
  h.drive(0, 150);
  h.clock.t += 9000; h.session.tick();
  assert.equal(h.last().state, 'GPS_WEAK');
  assert.equal(h.last().gpsIssue, 'no_signal');
  h.session.handleFix(h.fix(200, {dt: 100}));
  assert.equal(h.last().state, 'ACTIVE');
});

test('geolocation errors: denied is terminal and releases the watcher; unavailable and timeout are recoverable; unsupported fails cleanly', () => {
  let h = harness();
  h.session.start();
  h.session.onGeoError({code: 1});
  assert.equal(h.last().state, 'ERROR'); assert.equal(h.last().reason, 'denied');
  assert.equal(h.geo.watchers.size, 0); assert.equal(h.timers.list.size, 0);
  h = harness(); h.session.start(); h.drive(0, 60);
  h.session.onGeoError({code: 2}); assert.equal(h.last().state, 'ACTIVE', 'one transient error between fixes does not flicker the UI');
  h.session.handleFix(h.fix(70)); h.session.onGeoError({code: 2}); h.session.handleFix(h.fix(80)); assert.equal(h.last().state, 'ACTIVE');
  h.clock.t += 9000; h.session.tick();
  assert.equal(h.last().state, 'GPS_WEAK'); assert.equal(h.last().gpsIssue, 'unavailable', 'a sustained silence after errors is reported with its cause');
  h.session.onGeoError({code: 3}); h.clock.t += 1000; h.session.tick(); assert.equal(h.last().gpsIssue, 'timeout');
  assert.equal(h.geo.watchers.size, 1, 'the watcher keeps running');
  h.session.handleFix(h.fix(90)); assert.equal(h.last().state, 'ACTIVE');
  h = harness({geo: null}); assert.equal(h.session.start(), false);
  assert.equal(h.last().state, 'ERROR'); assert.equal(h.last().reason, 'unsupported');
});

// ---- off route and rerouting -------------------------------------------------------------------------------
const NEW_ROUTE = () => core.validRoute({...body, geometry: {type: 'LineString', coordinates: body.geometry.coordinates.slice(3)}, steps: body.steps.slice(1)});

test('off-route needs several confirmed fixes; one stray fix does nothing', () => {
  const h = harness();
  h.session.start(); h.drive(0, 300);
  h.session.handleFix(h.fix(330, {side: 60}));
  assert.equal(h.last().state, 'ACTIVE'); assert.equal(h.requests.length, 0);
  h.session.handleFix(h.fix(345));
  h.session.handleFix(h.fix(360, {side: 60, dt: 1000}));
  h.session.handleFix(h.fix(375, {side: 60, dt: 1000}));
  assert.equal(h.last().state, 'ACTIVE', 'two stray fixes, not three');
  assert.equal(h.requests.length, 0);
});

test('off-route threshold grows with GPS accuracy; fixes worse than 60 m never count', () => {
  const h = harness();
  h.session.start(); h.drive(0, 300);
  for (let i = 0; i < 6; i++) h.session.handleFix(h.fix(320 + i * 10, {side: 70, acc: 90, dt: 1000}));
  assert.equal(h.last().state, 'ACTIVE', 'accuracy 90 m: not enough evidence');
  for (let i = 0; i < 6; i++) h.session.handleFix(h.fix(380 + i * 10, {side: 60, acc: 40, dt: 1000}));
  assert.equal(h.last().state, 'ACTIVE', '60 m away with 40 m accuracy is within 35+40');
});

test('confirmed deviation: OFF_ROUTE then ONE reroute request from the current position to the original destination', async () => {
  const h = harness();
  h.session.start(); h.drive(0, 300);
  h.deviate(300, 4);
  assert.equal(h.last().state, 'REROUTING');
  assert.equal(h.requests.length, 1);
  const req = h.requests[0];
  assert.deepEqual(Object.keys(req).filter(k => !['resolve', 'reject'].includes(k)).sort(), ['from', 'lang', 'mode', 'onSlow', 'signal', 'to']);
  assert.equal(req.mode, 'car'); assert.equal(req.lang, 'ru');
  assert.deepEqual(req.to, {lat: ROUTE.coordinates.at(-1)[1], lon: ROUTE.coordinates.at(-1)[0]});
  const p = h.last().position;
  assert.ok(nav.haversine(req.from.lat, req.from.lon, p.lat, p.lon) < 40, 'the new start is where the user is now');
  h.deviate(340, 5, {from: 200});
  assert.equal(h.requests.length, 1, 'no second request while one is in flight');
  req.onSlow(); assert.equal(h.last().reroute.slow, true);
  req.resolve(NEW_ROUTE()); await flush();
  assert.notEqual(h.last().state, 'REROUTING');
  assert.equal(h.session.index.pts.length, 6, 'the new geometry replaced the old one');
  assert.equal(h.last().reroute.count, 1);
  assert.deepEqual(h.events.map(e => e.type).filter(t => t === 'rerouted'), ['rerouted']);
});

test('reroute failure keeps a safe state, backs off, honours Retry-After, stops after repeated failures and can be retried manually', async () => {
  const h = harness({config: {backoffMs: [4000, 8000], maxAutoFailures: 3, cooldownMs: 10000}});
  h.session.start(); h.drive(0, 300);
  const deviate = () => h.session.handleFix(h.fix(330, {side: 300, dt: 100}));
  h.deviate(310, 4);
  assert.equal(h.requests.length, 1);
  h.requests[0].reject(Object.assign(new Error('x'), {code: 'rate_limited', retryAfter: 30})); await flush();
  assert.equal(h.last().state, 'OFF_ROUTE'); assert.equal(h.last().reroute.error, 'rate_limited');
  assert.ok(h.last().reroute.retryInMs >= 29000, 'Retry-After respected: ' + h.last().reroute.retryInMs);
  for (let i = 0; i < 10; i++) deviate();
  assert.equal(h.requests.length, 1, 'no new request before Retry-After elapses');
  h.clock.t += 31000; h.session.tick();
  const timer = [...h.timers.list.values()].find(x => x.kind === 't'); assert.ok(timer, 'a retry timer is armed');
  timer.f(); await flush();
  deviate();
  assert.equal(h.requests.length, 2);
  h.requests[1].reject(Object.assign(new Error('x'), {code: 'unavailable', transient: true})); await flush();
  assert.equal(h.last().reroute.error, 'unavailable'); assert.equal(h.last().state, 'OFF_ROUTE');
  h.clock.t += 11000; deviate();
  assert.equal(h.requests.length, 3);
  h.requests[2].reject(Object.assign(new Error('x'), {code: 'timeout', transient: true})); await flush();
  assert.equal(h.last().reroute.manualOnly, true, 'no endless automatic retries');
  h.clock.t += 120000; for (let i = 0; i < 5; i++) deviate();
  assert.equal(h.requests.length, 3);
  assert.equal(h.session.retryReroute(), true);
  assert.equal(h.requests.length, 4); assert.equal(h.last().state, 'REROUTING');
  h.requests[3].resolve(NEW_ROUTE()); await flush();
  assert.notEqual(h.last().state, 'REROUTING'); assert.equal(h.last().reroute.manualOnly, false);
});

test('reroute loop guard: too many reroutes in the window require a manual retry', async () => {
  const h = harness({config: {cooldownMs: 1000, loopMax: 2}});
  h.session.start();
  for (let n = 0; n < 3; n++) {
    h.session.handleFix(h.fix(0, {dt: 1500})); h.session.handleFix(h.fix(5, {dt: 1500}));
    h.deviate(30, 4, {dt: 1200});
    if (h.requests[n]) { h.requests[n].resolve(ROUTE); await flush(); }
  }
  assert.equal(h.requests.length, 2, 'the third automatic reroute is withheld');
  assert.equal(h.last().reroute.manualOnly, true); assert.equal(h.last().reroute.error, 'too_many');
});

test('rejoining the route cancels a pending reroute; a late reply is ignored', async () => {
  const h = harness();
  h.session.start(); h.drive(0, 300);
  h.deviate(310, 4);
  assert.equal(h.last().state, 'REROUTING');
  const req = h.requests[0]; let aborted = false; req.signal.addEventListener('abort', () => { aborted = true; });
  for (const side of [90, 60, 30, 5, 0]) h.session.handleFix(h.fix(335, {side, dt: 1000}));   // drives back onto the road
  assert.equal(h.last().state, 'ACTIVE'); assert.equal(aborted, true, 'the in-flight request was cancelled');
  const geometry = h.session.index.pts.length;
  req.resolve(NEW_ROUTE()); await flush();
  assert.equal(h.session.index.pts.length, geometry, 'stale reply did not replace the route');
});

// ---- arrival ----------------------------------------------------------------------------------------------
test('arrival: needs repeated fixes at the end of the route, finishes the session and frees the watcher', () => {
  const h = harness();
  h.session.start(); h.drive(0, h.index.total - 60, 20);
  h.session.handleFix(h.fix(h.index.total - 5));
  assert.equal(h.last().state, 'ACTIVE', 'one fix is not enough');
  h.session.handleFix(h.fix(h.index.total - 3));
  assert.equal(h.last().state, 'ARRIVED');
  assert.equal(h.geo.watchers.size, 0); assert.equal(h.timers.list.size, 0);
  assert.ok(h.events.some(e => e.type === 'arrived'));
  assert.equal(h.session.handleFix(h.fix(h.index.total)), false, 'fixes after the end are ignored');
});

test('passing the destination on a parallel road does not end navigation', () => {
  const h = harness();
  h.session.start(); h.drive(0, h.index.total - 200, 20);
  for (let i = 0; i < 6; i++) h.session.handleFix(h.fix(h.index.total - 25 + i * 3, {side: 70, acc: 6, dt: 800}));   // 70 m beside the destination
  assert.notEqual(h.last().state, 'ARRIVED');
});

test('walking onto a destination that is off the road network arrives within the free-arrival radius', () => {
  const h = harness({mode: 'foot', route: core.validRoute({...body, mode: 'foot'})});
  h.session.start(); h.drive(0, h.index.total - 50, 6);
  for (let i = 0; i < 3; i++) h.session.handleFix(h.fix(h.index.total - 2, {side: 9, acc: 6, dt: 1000}));
  assert.equal(h.last().state, 'ARRIVED');
});

// ---- background, cleanup, privacy -------------------------------------------------------------------------
test('background: PAUSED ignores fixes; resume forgets the stale fix and needs a fresh one; the whole route is searched once', () => {
  const h = harness();
  h.session.start(); h.drive(0, 600);
  assert.equal(h.session.pause(), true);
  assert.equal(h.last().state, 'PAUSED');
  assert.equal(h.session.handleFix(h.fix(700)), false);
  h.clock.t += 120000;
  assert.equal(h.session.resume(), true);
  assert.equal(h.last().state, 'PREPARING'); assert.equal(h.last().position, null, 'the stale position is not shown');
  assert.equal(h.session.handleFix(h.fix(650, {ts: h.clock.t - 60000, dt: 0})), false, 'cached fix from before the resume is stale');
  assert.equal(h.session.handleFix(h.fix(1500, {dt: 500})), true);
  assert.equal(h.last().state, 'ACTIVE');
  assert.ok(h.last().progress.alongM > 1400, 'the user moved on while in the background: ' + h.last().progress.alongM);
});

test('stop releases watcher, timers and requests and is idempotent; a late reroute reply changes nothing', async () => {
  const h = harness();
  h.session.start(); h.drive(0, 300);
  h.deviate(310, 4);
  const req = h.requests[0]; let aborted = false; req.signal.addEventListener('abort', () => { aborted = true; });
  h.session.stop(); h.session.stop();
  assert.equal(h.last().state, 'STOPPED'); assert.equal(aborted, true);
  assert.equal(h.geo.watchers.size, 0); assert.equal(h.geo.cleared, 1); assert.equal(h.timers.list.size, 0);
  assert.equal(h.last().position, null);
  const n = h.updates.length;
  req.resolve(NEW_ROUTE()); await flush();
  h.session.handleFix(h.fix(400)); h.session.tick();
  assert.equal(h.updates.length, n, 'a stopped session emits nothing');
  assert.equal(h.session.start(), false, 'a stopped session cannot be restarted');
});

test('manager: starting a session stops the previous one, so there is never more than one GPS watcher', () => {
  const geo1 = harness().geo, geo2 = harness().geo;
  const mk = geo => ({route: ROUTE, geo, fetchRoute: () => new Promise(() => {}), mode: 'car', lang: 'en'});
  const manager = nav.createManager();
  const a = manager.start(mk(geo1)); assert.equal(geo1.watchers.size, 1);
  const b = manager.start(mk(geo2));
  assert.equal(a.state, 'STOPPED'); assert.equal(geo1.watchers.size, 0); assert.equal(geo2.watchers.size, 1);
  assert.equal(manager.current, b);
  manager.stop(); assert.equal(geo2.watchers.size, 0); assert.equal(manager.current, null);
});

test('privacy: no history is retained, nothing is stored or sent except the injected reroute request', async () => {
  const sent = [];
  const realFetch = globalThis.fetch; globalThis.fetch = () => { sent.push('fetch'); throw new Error('network is not allowed in the core'); };
  try {
    const h = harness();
    h.session.start();
    h.drive(0, 400, 5);
    const small = JSON.stringify({...h.last(), route: null}).length;
    h.drive(405, 900, 5);
    const larger = JSON.stringify({...h.last(), route: null}).length;
    assert.ok(Math.abs(larger - small) < 400, 'snapshot size does not grow with the number of fixes');
    for (const key of Object.keys(h.last())) assert.ok(!/history|track|trail|path/i.test(key), key);
    assert.deepEqual(sent, []);
    h.session.stop();
    assert.equal(h.last().position, null);
  } finally { globalThis.fetch = realFetch; }
  const source = fs.readFileSync(path.join(__dirname, '..', 'nav.js'), 'utf8');
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'sendBeacon', 'XMLHttpRequest', 'location.hash', 'history.', 'document.cookie']) assert.ok(!source.includes(forbidden), forbidden);
  assert.ok(!/\bfetch\(/.test(source.replace(/fetchRoute\(/g, '')), 'the core never calls fetch itself');
});

// ---- camera, i18n, formatting ------------------------------------------------------------------------------
test('camera target: heading-up only with a reliable heading, speed-dependent zoom, no pitch on foot', () => {
  const h = harness();
  h.session.start(); h.session.handleFix(h.fix(0)); h.session.handleFix(h.fix(30, {dt: 2000}));
  const snap = h.last();
  const cam = nav.cameraTarget(snap);
  assert.equal(cam.headingUp, true); assert.ok(cam.bearing > 60 && cam.bearing < 120, 'heading east: ' + cam.bearing); assert.equal(cam.pitch, 50);
  assert.equal(nav.cameraTarget({...snap, position: {...snap.position, heading: null}}).bearing, 0);
  assert.equal(nav.cameraTarget({...snap, position: {...snap.position, heading: null}}).pitch, 0);
  assert.equal(nav.cameraTarget(snap, {headingUp: false}).bearing, 0);
  assert.equal(nav.cameraTarget({...snap, mode: 'foot'}).pitch, 0);
  assert.equal(nav.cameraTarget({...snap, position: null}), null);
  assert.ok(nav.cameraTarget({...snap, position: {...snap.position, speed: 25}}).zoom < nav.cameraTarget({...snap, position: {...snap.position, speed: 2}}).zoom);
});

test('maneuver texts exist in RU, KK and EN for every known Valhalla type; unknown types fall back to the API text with its language', () => {
  const langs = ['ru', 'kk', 'en'];
  for (const type of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 37, 38]) {
    const texts = langs.map(lang => nav.maneuverText({type, street: 'Абай', instruction: 'x'}, lang, 'ru'));
    for (const t of texts) { assert.ok(t.text && t.text !== 'x' && !/^[a-z]+[A-Z]?[a-zA-Z]*$/.test(t.text), `type ${type}: ${t.text}`); assert.equal(t.street, 'Абай'); assert.equal(t.fallback, null); assert.ok(t.icon); }
    assert.equal(new Set(texts.map(t => t.text)).size >= 2, true);
  }
  const fb = nav.maneuverText({type: 999, street: '', instruction: 'Take the thing.'}, 'kk', 'ru');
  assert.equal(fb.text, 'Take the thing.'); assert.equal(fb.fallback, 'ru');
  assert.equal(nav.maneuverText({type: 999, street: '', instruction: 'Take the thing.'}, 'ru', 'ru').fallback, null);
  assert.equal(nav.maneuverText({type: 15, street: ''}, 'kk').text, 'Солға бұрылыңыз');
  assert.equal(nav.maneuverText({type: 15, street: ''}, 'en').text, 'Turn left');
});

test('every UI string exists in all three languages', () => {
  const keys = lang => Object.keys(nav.NAV_STRINGS[lang]).sort();
  assert.deepEqual(keys('kk'), keys('ru')); assert.deepEqual(keys('en'), keys('ru'));
  for (const lang of ['ru', 'kk', 'en']) for (const [k, v] of Object.entries(nav.NAV_STRINGS[lang])) assert.ok(v && v.length, lang + '.' + k);
});

test('formatting: distances, durations and arrival clock in RU/KK/EN', () => {
  assert.equal(nav.formatNavDistance(350, 'ru'), '350 м');
  assert.equal(nav.formatNavDistance(347, 'ru'), '350 м');
  assert.equal(nav.formatNavDistance(83, 'ru'), '80 м');
  assert.equal(nav.formatNavDistance(1240, 'ru'), '1,2 км');
  assert.equal(nav.formatNavDistance(1240, 'en'), '1.2 km');
  assert.equal(nav.formatNavDistance(7400, 'kk'), '7,4 км');
  assert.equal(nav.formatNavDistance(18400, 'ru'), '18 км');
  assert.equal(nav.formatNavDistance(980, 'en'), '1 km');
  assert.equal(nav.formatNavDistance(NaN, 'ru'), '');
  assert.equal(nav.formatNavDuration(18 * 60, 'ru'), '18 мин');
  assert.equal(nav.formatNavDuration(65 * 60, 'ru'), '1 ч 05 мин');
  assert.equal(nav.formatNavDuration(65 * 60, 'kk'), '1 сағ 05 мин');
  assert.equal(nav.formatNavDuration(65 * 60, 'en'), '1 h 05 min');
  assert.equal(nav.formatNavDuration(10, 'en'), '1 min');
  assert.equal(nav.formatClock(Date.UTC(2026, 10, 22, 9, 35), 'Asia/Almaty'), '14:35');
});

test('language switch mid-session re-renders the maneuver text without touching progress', () => {
  const h = harness();
  h.session.start(); h.drive(0, 600);
  const ru = h.last();
  h.session.setLang('kk');
  const kk = h.last();
  assert.equal(ru.maneuver.text, 'Поверните налево'); assert.equal(kk.maneuver.text, 'Солға бұрылыңыз');
  assert.equal(kk.progress.alongM, ru.progress.alongM);
});

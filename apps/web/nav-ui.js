/* KUNDE Maps navigation UI (Phase 5): HUD, follow camera, position marker, wake lock. DOM + map glue around nav.js.
 * All text is written with textContent (route names are data). Nothing here stores or transmits positions. */
(function (root) {
  'use strict';

  const SVG = d => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>';
  const ICONS = {
    straight: 'M12 20V5m0 0-5 5m5-5 5 5',
    depart: 'M12 20V5m0 0-5 5m5-5 5 5',
    right: 'M6 20v-7a4 4 0 0 1 4-4h8m0 0-4-4m4 4-4 4',
    left: 'M18 20v-7a4 4 0 0 0-4-4H6m0 0 4-4M6 9l4 4',
    'slight-right': 'M7 20v-5.5L16 6m0 0h-5.5M16 6v5.5',
    'slight-left': 'M17 20v-5.5L8 6m0 0h5.5M8 6v5.5',
    'sharp-right': 'M6 5h7a4 4 0 0 1 4 4v10m0 0-3.5-3.5M17 19l3.5-3.5',
    'sharp-left': 'M18 5h-7a4 4 0 0 0-4 4v10m0 0 3.5-3.5M7 19l-3.5-3.5',
    uturn: 'M8 20V9a4 4 0 0 1 8 0v4m0 0-3-3m3 3 3-3',
    roundabout: 'M8 15a4 4 0 1 0 8 0 4 4 0 1 0-8 0M12 11V3m0 0L9 6m3-3 3 3M12 21v-2',
    merge: 'M12 20V6m0 0-4 4m4-4 4 4M5 20c3-1 5-3 7-6',
    ramp: 'M8 20V6m0 0-3 3m3-3 3 3M8 14c0-2 2-3 5-3h5',
    'ramp-right': 'M8 20v-6a4 4 0 0 1 4-4h6m0 0-3-3m3 3-3 3',
    'ramp-left': 'M16 20v-6a4 4 0 0 0-4-4H6m0 0 3-3M6 10l3 3',
    'exit-right': 'M8 20V6m0 0-3 3m3-3 3 3M8 14c0-2 2-3 5-3h5m0 0-3-3m3 3-3 3',
    'exit-left': 'M16 20V6m0 0-3 3m3-3 3 3M16 14c0-2-2-3-5-3H6m0 0 3-3M6 11l3 3',
    destination: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM9.7 10a2.3 2.3 0 1 0 4.6 0 2.3 2.3 0 1 0-4.6 0',
    ferry: 'M3 18c2 2 4 2 6 0s4-2 6 0 4 2 6 0M6 14l1-7h10l1 7z',
    gps: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0M5.5 12a6.5 6.5 0 1 0 13 0 6.5 6.5 0 1 0-13 0',
    alert: 'M12 8v5m0 3.5v.01M10.3 4l-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z',
  };
  const iconSvg = name => SVG(ICONS[name] || ICONS.straight);

  function create(deps) {
    const {map, maplibregl, nav, getLang, fetchRoute, setNavData, onExit = () => {}} = deps;
    const $ = id => document.getElementById(id);
    const el = {root: $('nav'), banner: $('nav-banner'), icon: $('nav-icon'), dist: $('nav-dist'), text: $('nav-text'), street: $('nav-street'),
      then: $('nav-then'), thenIcon: $('nav-then-icon'), thenText: $('nav-then-text'), alert: $('nav-alert'), alertText: $('nav-alert-text'),
      spinner: $('nav-alert-spinner'), retry: $('nav-retry'), announce: $('nav-announce'), recenter: $('nav-recenter'), stepsPanel: $('nav-steps-panel'),
      stepsList: $('nav-steps-list'), stepsBtn: $('nav-steps-btn'), end: $('nav-end'), bottom: $('nav-bottom'), safety: $('nav-safety'),
      eta: $('nav-eta'), etaLabel: $('nav-eta-label'), leftTime: $('nav-left-time'), leftLabel: $('nav-left-label'), leftDist: $('nav-left-dist'),
      distLabel: $('nav-dist-label'), bar: $('nav-progress-bar'), top: document.querySelector('#nav .nav-top')};
    const manager = nav.createManager();
    const reduceMotion = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const t = key => nav.navT(getLang(), key);

    let active = false, session = null, following = true, userZoom = null, stepsOpen = false, endArmed = null;
    let puck = null, puckEl = null, shown = null, target = null, frame = 0, lastFrameAt = 0;
    let lastCamAt = 0, lastCam = null, lastSplit = null, lastGeometry = null, wakeLock = null, safetyTimer = null;
    let lastAnnounce = {index: -1, bucket: Infinity}, lastSnap = null, mode = 'car';

    // ---- static labels ---------------------------------------------------------------------------------------
    function labels() {
      el.root.setAttribute('aria-label', t('title'));
      el.recenter.querySelector('span').textContent = t('recenter');
      el.stepsBtn.textContent = stepsOpen ? t('stepsClose') : t('steps');
      el.etaLabel.textContent = t('eta'); el.leftLabel.textContent = t('left_'); el.distLabel.textContent = t('distance');
      el.retry.textContent = t('retry');
      el.stepsPanel.setAttribute('aria-label', t('steps'));
      if (!endArmed) el.end.textContent = lastSnap && lastSnap.state === 'ARRIVED' ? t('done') : t('end');
      el.safety.textContent = t('safety');
    }

    // ---- rendering -------------------------------------------------------------------------------------------
    const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
    function alertFor(snap) {
      const r = snap.reroute;
      switch (snap.state) {
        case 'GPS_WEAK': return {kind: 'warn', text: t(snap.gpsIssue === 'no_signal' ? 'gpsLost' : snap.gpsIssue === 'unavailable' ? 'gpsUnavailable' : snap.gpsIssue === 'timeout' ? 'gpsTimeout' : 'gpsWeak')};
        case 'REROUTING': return {kind: 'info', spin: true, text: t(r.slow ? 'reroutingSlow' : 'rerouting')};
        case 'OFF_ROUTE':
          if (r.error) {
            const base = r.error === 'rate_limited' ? nav.navT(getLang(), 'rerouteRateLimited', {n: Math.ceil(r.retryInMs / 1000)}) : t(r.error === 'too_many' ? 'rerouteLimit' : r.error === 'unavailable' ? 'rerouteUnavailable' : 'rerouteFailed');
            const wait = !r.manualOnly && r.retryInMs > 0 && r.error !== 'rate_limited' ? ' ' + nav.navT(getLang(), 'retrying', {n: Math.ceil(r.retryInMs / 1000)}) : '';
            return {kind: 'error', text: base + wait};
          }
          return {kind: 'info', spin: true, text: t('offRoute')};
        case 'PAUSED': return {kind: 'warn', text: t('paused')};
        case 'PREPARING': return snap.reason === 'resume' ? {kind: 'info', spin: true, text: t('resuming')} : null;
        default: return null;
      }
    }
    function render(snap) {
      if (!active) return;
      lastSnap = snap;
      el.root.dataset.state = snap.state;
      const lang = getLang();
      // banner
      let icon = 'straight', dist = '', text = '', street = '', fallback = null;
      if (snap.state === 'ERROR') { icon = 'alert'; text = t(snap.reason === 'denied' ? 'denied' : snap.reason === 'unsupported' ? 'unsupported' : 'error'); }
      else if (snap.state === 'ARRIVED') { icon = 'destination'; text = t('arrived'); }
      else if (snap.state === 'PREPARING' && !snap.position) { icon = 'gps'; text = t('preparing'); street = t('preparingHint'); }
      else if (snap.maneuver) {
        const m = snap.maneuver;
        icon = m.icon; text = m.text; street = m.street; fallback = m.fallback;
        dist = m.distanceM < 30 ? t('now') : nav.formatNavDistance(m.distanceM, lang);
      }
      el.icon.innerHTML = iconSvg(icon);
      setText(el.dist, dist); setText(el.text, text); setText(el.street, street + (fallback ? (street ? ' · ' : '') + nav.navT(lang, 'fallbackLang', {l: fallback.toUpperCase()}) : ''));
      el.dist.hidden = !dist; el.street.hidden = !el.street.textContent;
      el.banner.dataset.stale = snap.state === 'OFF_ROUTE' || snap.state === 'REROUTING' || snap.state === 'PAUSED' ? 'true' : 'false';
      // "then" hint when the next maneuver follows closely
      const nx = snap.nextManeuver, cur = snap.maneuver;
      const showThen = !!(nx && cur && snap.state !== 'ARRIVED' && snap.state !== 'ERROR' && nx.distanceM - cur.distanceM <= 300 && cur.distanceM < 400);
      el.then.hidden = !showThen;
      if (showThen) { el.thenIcon.innerHTML = iconSvg(nx.icon); setText(el.thenText, t('then') + ': ' + nx.text + (nx.street ? ' · ' + nx.street : '')); }
      // alert strip
      const a = alertFor(snap);
      el.alert.hidden = !a;
      if (a) {
        el.alert.dataset.kind = a.kind; el.spinner.hidden = !a.spin; setText(el.alertText, a.text);
        el.retry.hidden = !(snap.state === 'OFF_ROUTE' && snap.reroute.error && (snap.reroute.manualOnly || snap.reroute.retryInMs <= 0));
      }
      // bottom bar
      const terminal = snap.state === 'ARRIVED' || snap.state === 'ERROR';
      el.bottom.dataset.terminal = String(terminal);
      const p = snap.progress;
      setText(el.eta, terminal ? '--:--' : nav.formatClock(p.etaMs));
      setText(el.leftTime, snap.state === 'ARRIVED' ? '0 ' + t('min') : nav.formatNavDuration(p.remainingS, lang));
      setText(el.leftDist, snap.state === 'ARRIVED' ? '0 ' + t('m') : nav.formatNavDistance(p.remainingM, lang));
      el.bar.style.width = Math.round(Math.min(1, Math.max(0, p.fraction)) * 100) + '%';
      if (!endArmed) setText(el.end, snap.state === 'ARRIVED' ? t('done') : snap.state === 'ERROR' ? t('close') : t('end'));
      el.end.classList.toggle('danger', !terminal); el.end.classList.toggle('primary', terminal);
      el.stepsBtn.hidden = terminal;
      if (terminal && stepsOpen) toggleSteps(false);
      if (stepsOpen) renderSteps(snap);
      announce(snap);
      // map
      updateRoute(snap);
      updatePuck(snap);
      if (snap.position && snap.state !== 'PAUSED') applyCamera(snap, false);
    }
    function announce(snap) {
      const m = snap.maneuver;
      if (!m || snap.state !== 'ACTIVE') return;
      const bucket = [50, 100, 200, 500].find(b => m.distanceM <= b) || Infinity;
      if (m.index === lastAnnounce.index && bucket >= lastAnnounce.bucket) return;
      if (m.index !== lastAnnounce.index || bucket < lastAnnounce.bucket) {
        if (bucket !== Infinity || m.index !== lastAnnounce.index) {
          const lang = getLang();
          el.announce.textContent = (m.distanceM < 30 ? t('now') : nav.navT(lang, 'inDistance', {d: nav.formatNavDistance(m.distanceM, lang)})) + '. ' + m.text + (m.street ? ', ' + m.street : '');
        }
        lastAnnounce = {index: m.index, bucket};
      }
    }
    function renderSteps(snap) {
      const lang = getLang();
      const items = snap.remainingSteps.slice(0, 40);
      const nodes = items.map(s => {
        const li = document.createElement('li'); if (s.current) li.setAttribute('aria-current', 'step');
        const ic = document.createElement('span'); ic.className = 'nav-step-icon'; ic.innerHTML = iconSvg(s.icon);
        const body = document.createElement('span'); body.className = 'nav-step-body';
        const tx = document.createElement('strong'); tx.textContent = s.text;
        const st = document.createElement('small'); st.textContent = (s.street || '') + (s.fallback ? (s.street ? ' · ' : '') + nav.navT(lang, 'fallbackLang', {l: s.fallback.toUpperCase()}) : '');
        body.append(tx); if (st.textContent) body.append(st);
        const d = document.createElement('span'); d.className = 'nav-step-dist'; d.textContent = s.distanceM < 30 ? t('now') : nav.formatNavDistance(s.distanceM, lang);
        li.append(ic, body, d);
        return li;
      });
      el.stepsList.replaceChildren(...nodes);
    }
    function toggleSteps(open) {
      stepsOpen = open === undefined ? !stepsOpen : open;
      el.stepsPanel.hidden = !stepsOpen;
      el.stepsBtn.setAttribute('aria-expanded', String(stepsOpen));
      el.stepsBtn.textContent = stepsOpen ? t('stepsClose') : t('steps');
      if (stepsOpen && lastSnap) renderSteps(lastSnap);
    }

    // ---- map: route progress -----------------------------------------------------------------------------------
    function updateRoute(snap) {
      const geom = snap.route.geometry, a = snap.progress.alongM;
      if (lastGeometry === geom && lastSplit !== null && Math.abs(a - lastSplit) < 4 && snap.state !== 'ARRIVED') return;
      const [done, left] = nav.splitRoute(snap.route.index, a);
      lastGeometry = geom; lastSplit = a;
      const line = (coords, part) => ({type: 'Feature', properties: {part}, geometry: {type: 'LineString', coordinates: coords.length >= 2 ? coords : [coords[0], coords[0]]}});
      setNavData({type: 'FeatureCollection', features: [line(done, 'done'), line(left, 'left')]});
    }

    // ---- map: position marker with smoothing ------------------------------------------------------------------
    function makePuck() {
      const el0 = document.createElement('div');
      el0.className = 'nav-puck';
      el0.innerHTML = '<span class="nav-puck-ring"></span><span class="nav-puck-arrow"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 19 20l-7-3.5L5 20Z"/></svg></span><span class="nav-puck-dot"></span>';
      el0.setAttribute('role', 'img');
      return el0;
    }
    function updatePuck(snap) {
      const p = snap.position;
      if (!p) { if (puck) { puck.remove(); puck = null; puckEl = null; shown = null; target = null; } return; }
      if (!puck) {
        puckEl = makePuck();
        puck = new maplibregl.Marker({element: puckEl, anchor: 'center'}).setLngLat([p.lon, p.lat]).addTo(map);
        shown = {lon: p.lon, lat: p.lat};
      }
      puckEl.setAttribute('aria-label', t('title'));
      puckEl.dataset.heading = p.heading == null ? 'none' : 'yes';
      puckEl.classList.toggle('weak', snap.state === 'GPS_WEAK' || (p.accuracy || 0) > 50);
      if (p.heading != null) puckEl.style.setProperty('--puck-rot', (p.heading - (map.getBearing ? map.getBearing() : 0)) + 'deg');
      target = {lon: p.lon, lat: p.lat};
      if (reduceMotion()) { shown = {...target}; puck.setLngLat([shown.lon, shown.lat]); return; }
      if (!frame) { lastFrameAt = performance.now(); frame = requestAnimationFrame(step); }
    }
    function step(now) {
      frame = 0;
      if (!active || !puck || !target || !shown) return;
      const dt = Math.min(100, now - lastFrameAt); lastFrameAt = now;
      const k = 1 - Math.exp(-dt / 160);   // ~0.5 s to catch up: smooth, but the marker is never more than a fraction of a second behind the real fix
      shown.lon += (target.lon - shown.lon) * k; shown.lat += (target.lat - shown.lat) * k;
      puck.setLngLat([shown.lon, shown.lat]);
      if (Math.abs(target.lon - shown.lon) > 1e-7 || Math.abs(target.lat - shown.lat) > 1e-7) frame = requestAnimationFrame(step);
      else { shown = {...target}; puck.setLngLat([shown.lon, shown.lat]); }
    }
    if (map.on) map.on('rotate', () => { if (active && puckEl && lastSnap && lastSnap.position && lastSnap.position.heading != null) puckEl.style.setProperty('--puck-rot', (lastSnap.position.heading - (map.getBearing ? map.getBearing() : 0)) + 'deg'); });

    // ---- map: follow camera -------------------------------------------------------------------------------------
    const isDesktop = () => root.matchMedia && root.matchMedia('(min-width: 720px)').matches;
    function padding() {
      const top = el.top.getBoundingClientRect().bottom, bottom = root.innerHeight - el.bottom.getBoundingClientRect().top;
      const left = isDesktop() ? el.top.getBoundingClientRect().right + 12 : 0;
      return {top: Math.max(0, Math.round(top + 8)), bottom: Math.max(0, Math.round(bottom + 8)), left: Math.round(left), right: 0};
    }
    function applyCamera(snap, force) {
      if (!following && !force) return;
      const cam = nav.cameraTarget(snap, {headingUp: true});
      if (!cam) return;
      const now = performance.now();
      if (!force && now - lastCamAt < 450) return;
      if (!force && lastCam && nav.haversine(lastCam.lat, lastCam.lon, cam.lat, cam.lon) < 1.5 && nav.angleDiff(lastCam.bearing, cam.bearing) < 4) return;
      lastCamAt = now; lastCam = cam;
      // one animation at a time: easeTo cancels the previous one, so camera moves never fight each other
      map.easeTo({center: [cam.lon, cam.lat], bearing: cam.bearing, pitch: cam.pitch, zoom: userZoom == null ? cam.zoom : userZoom, padding: padding(),
        duration: reduceMotion() ? 0 : force ? 600 : 800, easing: x => x, essential: true});
    }
    function recenter() {
      following = true; el.recenter.hidden = true;
      if (lastSnap && lastSnap.position) applyCamera(lastSnap, true);
    }
    if (map.on) {
      map.on('dragstart', e => { if (active && e && e.originalEvent && following) { following = false; el.recenter.hidden = false; } });
      map.on('zoomend', e => { if (active && e && e.originalEvent) userZoom = map.getZoom(); });
    }
    el.recenter.addEventListener('click', recenter);

    // ---- screen wake lock (best effort; released with the session) -------------------------------------------------
    async function requestWake() {
      try {
        if (!active || wakeLock || !root.navigator.wakeLock || document.hidden) return;
        wakeLock = await root.navigator.wakeLock.request('screen');
        wakeLock.addEventListener && wakeLock.addEventListener('release', () => { wakeLock = null; });
        if (!active) releaseWake();
      } catch (_) { wakeLock = null; }
    }
    function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (_) { /* already released */ } wakeLock = null; }

    // ---- background / foreground ------------------------------------------------------------------------------------
    document.addEventListener('visibilitychange', () => {
      if (!active || !session) return;
      if (document.hidden) session.pause();
      else { session.resume(); requestWake(); }
    });

    // ---- controls ---------------------------------------------------------------------------------------------------
    el.stepsBtn.addEventListener('click', () => toggleSteps());
    el.retry.addEventListener('click', () => { if (session) session.retryReroute(); });
    el.end.addEventListener('click', () => {
      if (!active) return;
      const finished = lastSnap && (lastSnap.state === 'ARRIVED' || lastSnap.state === 'ERROR');
      if (finished || endArmed) { stop(finished ? (lastSnap.state === 'ARRIVED' ? 'arrived' : 'error') : 'user'); return; }
      // two taps, no dialog: nothing covers the route while driving
      el.end.textContent = t('endConfirm'); endArmed = setTimeout(() => { endArmed = null; if (active) labels(); }, 3500);
    });
    document.addEventListener('keydown', e => {
      if (!active || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape' && stepsOpen) { toggleSteps(false); el.stepsBtn.focus(); }
      else if (e.key === 'c' || e.key === 'C') recenter();
      else if (e.key === 'l' || e.key === 'L') toggleSteps();
    });
    if (root.ResizeObserver) {
      const sync = () => { document.documentElement.style.setProperty('--nav-bottom-h', Math.round(el.bottom.getBoundingClientRect().height) + 'px'); };
      new ResizeObserver(sync).observe(el.bottom);
    }

    // ---- lifecycle ----------------------------------------------------------------------------------------------------
    function start({route, destination, mode: travelMode}) {
      if (active) stop('replaced');
      active = true; mode = travelMode || route.mode || 'car'; following = true; userZoom = null; lastCam = null; lastSplit = null; lastGeometry = null;
      lastAnnounce = {index: -1, bucket: Infinity}; lastSnap = null; endArmed = null; stepsOpen = false;
      el.stepsPanel.hidden = true; el.recenter.hidden = true;
      document.body.classList.add('nav-on');
      el.root.hidden = false;
      labels();
      // Permission prompt happens here, inside the click that started navigation.
      session = manager.start({route, destination, mode, lang: getLang(), geo: root.navigator.geolocation,
        fetchRoute: req => fetchRoute({...req, lang: getLang()}), onUpdate: render, onEvent: () => {}});
      requestWake();
      el.safety.hidden = false; clearTimeout(safetyTimer); safetyTimer = setTimeout(() => { el.safety.hidden = true; }, 12000);
      return session;
    }
    function stop(reason) {
      if (!active) return;
      active = false;
      manager.stop(); session = null;
      clearTimeout(endArmed); endArmed = null; clearTimeout(safetyTimer);
      if (frame) cancelAnimationFrame(frame); frame = 0;
      if (puck) puck.remove(); puck = null; puckEl = null; shown = null; target = null;
      setNavData({type: 'FeatureCollection', features: []});
      releaseWake();
      document.body.classList.remove('nav-on');
      document.documentElement.style.removeProperty('--nav-bottom-h');
      el.root.hidden = true; el.alert.hidden = true; el.stepsPanel.hidden = true; el.recenter.hidden = true; el.stepsList.replaceChildren();
      if (map.easeTo) map.easeTo({bearing: 0, pitch: 0, padding: {top: 0, bottom: 0, left: 0, right: 0}, duration: reduceMotion() ? 0 : 500, essential: true});
      lastSnap = null;
      onExit(reason);
    }
    function setLang() { if (!active) return; labels(); if (lastSnap) render(lastSnap); if (session) session.setLang(getLang()); }

    return {start, stop, setLang, get active() { return active; }};
  }

  root.KundeNavUI = {create, ICONS};
})(typeof self !== 'undefined' ? self : this);

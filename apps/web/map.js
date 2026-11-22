/* KUNDE Maps web: self-hosted Kazakhstan PMTiles via MapLibre + real Search API integration. */
(async function () {
  const core = window.KundeCore;
  const $ = id => document.getElementById(id);
  const status = $('status');
  if (!core) { status.textContent = 'Карта не настроена: core.js не загружен'; return; }
  const root = document.documentElement;

  // ---- tiny helpers -------------------------------------------------------------------------
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* private mode */ } },
  };
  let lang = core.LANGS.includes(store.get('kunde-lang')) ? store.get('kunde-lang') : 'ru';
  const tr = (key, params) => core.t(lang, key, params);
  let statusTimer = null;
  // sticky messages (errors) stay; transient confirmations fade out.
  function setStatus(text, sticky) {
    status.textContent = text;
    status.classList?.remove('quiet');
    clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(() => status.classList?.add('quiet'), 3500);
  }

  try {
    if (!window.pmtiles || !window.maplibregl) throw new Error('Map libraries unavailable');
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    const response = await fetch('./config.json', {cache: 'no-store'});
    if (!response.ok) throw new Error('config.json not found');
    const config = await response.json();
    if (!config.styleUrl) throw new Error('Configure styleUrl in config.json');
    const searchBase = core.parseConfigUrl(config.searchUrl, true);
    const styleUrl = new URL(config.styleUrl, window.location.href);
    if (!['http:', 'https:'].includes(styleUrl.protocol)) throw new Error('Invalid style URL');
    const styleResponse = await fetch(styleUrl);
    if (!styleResponse.ok) throw new Error('Map style unavailable');
    const style = await styleResponse.json();
    // The development style uses localhost. Replace only that known local URL
    // with the current host; do not rewrite intentionally configured remote tile hosts.
    for (const source of Object.values(style.sources || {})) {
      if (typeof source.url === 'string' &&
          /^pmtiles:\/\/http:\/\/localhost:8080\/tiles\//.test(source.url)) {
        source.url = 'pmtiles://' + new URL(
          source.url.replace('pmtiles://http://localhost:8080', ''),
          window.location.origin
        ).href;
      }
    }
    // Optional HTTPS PMTiles host, configured independently from the static web image.
    if (config.tileUrl) {
      const remote = new URL(config.tileUrl);
      if (remote.protocol !== 'https:' && !(remote.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(remote.hostname))) {
        throw new Error('tileUrl must use HTTPS (except local development)');
      }
      if (!remote.pathname.endsWith('.pmtiles')) throw new Error('tileUrl must point to a .pmtiles archive');
      for (const source of Object.values(style.sources || {})) {
        if (typeof source.url === 'string' && source.url.startsWith('pmtiles://')) {
          source.url = 'pmtiles://' + remote.href;
        }
      }
    }
    // A successful style response does not imply that the PMTiles archive exists.
    // Check archives before creating the map so the page never reports "loaded"
    // while displaying an empty background.
    for (const source of Object.values(style.sources || {})) {
      if (typeof source.url !== 'string' || !source.url.startsWith('pmtiles://')) continue;
      const tileUrl = new URL(source.url.slice('pmtiles://'.length));
      if (tileUrl.protocol !== 'https:' && !(tileUrl.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(tileUrl.hostname))) {
        throw new Error('PMTiles host must use HTTPS');
      }
      const probe = await fetch(tileUrl.href, {method: 'GET', headers: {Range: 'bytes=0-15'}, cache: 'no-store'});
      if (probe.status !== 206) {
        throw new Error('PMTiles недоступен (HTTP ' + probe.status + '). Сначала создайте и опубликуйте архив карты.');
      }
      const contentRange = probe.headers.get('content-range') || '';
      if (!/^bytes 0-15\/\d+$/.test(contentRange)) {
        throw new Error('Сервер тайлов не поддерживает корректные HTTP Range-запросы.');
      }
    }

    // ---- map ------------------------------------------------------------------------------
    const initialPlace = core.parsePlaceHash(window.location.hash);
    const map = new maplibregl.Map({
      container: 'map', style,
      center: initialPlace ? [initialPlace.lng, initialPlace.lat] : [76.945, 43.238],
      zoom: initialPlace ? 15 : 11, attributionControl: {compact: true},
    });
    map.addControl(new maplibregl.NavigationControl({showCompass: false}), 'top-right');

    // ---- theme (UI tokens via CSS; map paint via palette) -------------------------------------
    const PALETTES = {
      light: {background: '#f6f7f4', landcover: '#dcead9', water: '#a6d7ed', buildings: '#d7d6d0', outline: '#b8b7b1',
        roads: '#ffffff', street: '#596476', place: '#283e58', halo: '#ffffff'},
      dark: {background: '#0f1626', landcover: '#16261f', water: '#12304a', buildings: '#1d2638', outline: '#2a3550',
        roads: '#3b4b6b', street: '#9fb0c8', place: '#dbe6f7', halo: '#0b1220'},
    };
    const prefersDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : {matches: false};
    const currentTheme = () => root.dataset.theme || (prefersDark.matches ? 'dark' : 'light');
    function applyMapTheme() {
      const p = PALETTES[currentTheme()];
      const paint = (layer, prop, value) => {
        try { if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value); } catch (_) { /* style not ready */ }
      };
      paint('background', 'background-color', p.background);
      paint('landcover', 'fill-color', p.landcover);
      paint('water', 'fill-color', p.water);
      paint('buildings', 'fill-color', p.buildings);
      paint('buildings', 'fill-outline-color', p.outline);
      paint('roads', 'line-color', p.roads);
      paint('street-labels', 'text-color', p.street);
      paint('street-labels', 'text-halo-color', p.halo);
      paint('place-labels', 'text-color', p.place);
      paint('place-labels', 'text-halo-color', p.halo);
      const meta = document.querySelectorAll('meta[name="theme-color"]');
      meta.forEach(m => { m.content = currentTheme() === 'dark' ? '#0b1220' : '#f8fafc'; m.removeAttribute('media'); });
    }
    $('theme').addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      store.set('kunde-theme', next);
      applyMapTheme();
    });
    if (prefersDark.addEventListener) prefersDark.addEventListener('change', () => { if (!root.dataset.theme) applyMapTheme(); });
    map.on('style.load', applyMapTheme);

    // ---- language ---------------------------------------------------------------------------
    const labelExpression = code => ['coalesce', ['get', 'name:' + code], ['get', 'name'], ''];
    const LANG_BUTTON = {ru: 'RU', kk: 'ҚАЗ', en: 'EN'};
    function applyLanguage() {
      root.lang = lang;
      $('language').textContent = LANG_BUTTON[lang];
      $('search-query').placeholder = tr('placeholder');
      $('search-label').textContent = tr('searchLabel');
      $('search-clear').setAttribute('aria-label', tr('clear'));
      $('sheet-handle').setAttribute('aria-label', tr('sheetToggle'));
      $('search-results').setAttribute('aria-label', tr('results'));
      for (const [id, key] of [['language', 'language'], ['theme', 'theme'], ['locate', 'locate']]) {
        $(id).setAttribute('aria-label', tr(key));
        $(id).title = tr(key);
      }
      $('share-place').textContent = tr('share');
      $('copy-place').textContent = tr('copyCoords');
      $('selection-close').setAttribute('aria-label', tr('close'));
      $('copy-coords').textContent = tr('copyCoords').split(' ')[0];
      try {
        for (const layer of ['street-labels', 'place-labels']) {
          if (map.getLayer(layer)) map.setLayoutProperty(layer, 'text-field', labelExpression(lang));
        }
      } catch (_) { /* style not ready yet; re-applied on load */ }
    }
    $('language').addEventListener('click', () => {
      lang = core.LANGS[(core.LANGS.indexOf(lang) + 1) % core.LANGS.length];
      store.set('kunde-lang', lang);
      applyLanguage();
      if (items.length && !resultsEl.hidden) renderResults();
      if (selected) showCard(selected);
      setStatus(tr('langChanged'));
    });

    // ---- sheet / panel plumbing ---------------------------------------------------------------
    const sheet = $('sheet'), stateEl = $('search-state'), resultsEl = $('search-results');
    const input = $('search-query'), clearBtn = $('search-clear'), card = $('selection');
    const isMobile = () => window.matchMedia('(max-width: 719px)').matches;
    const syncSheetHeight = () => {
      root.style.setProperty('--sheet-h', (!sheet.hidden && isMobile() ? sheet.offsetHeight : 0) + 'px');
    };
    if (window.ResizeObserver) new ResizeObserver(syncSheetHeight).observe(sheet);
    window.addEventListener('resize', syncSheetHeight);
    $('sheet-handle').addEventListener('click', () => {
      const expanded = sheet.dataset.expanded !== 'false';
      sheet.dataset.expanded = String(!expanded);
      $('sheet-handle').setAttribute('aria-expanded', String(!expanded));
      syncSheetHeight();
    });
    function refreshSheetVisibility() {
      sheet.hidden = stateEl.hidden && resultsEl.hidden && card.hidden;
      syncSheetHeight();
    }

    // ---- selection: marker + card -----------------------------------------------------------
    let marker = null, selected = null, userMarker = null;
    function makeMarkerElement() {
      const el = document.createElement('div');
      el.className = 'kunde-marker';
      el.innerHTML = '<svg viewBox="0 0 28 38" width="28" height="38" aria-hidden="true"><path fill="currentColor" d="M14 0C6.3 0 0 6.2 0 13.8 0 24 14 38 14 38s14-14 14-24.2C28 6.2 21.7 0 14 0Z"/><circle cx="14" cy="13.5" r="5" fill="#fff"/></svg>';
      return el;
    }
    function placeMarker(lngLat) {
      if (marker) marker.remove();
      marker = new maplibregl.Marker({element: makeMarkerElement(), anchor: 'bottom'}).setLngLat(lngLat).addTo(map);
    }
    function showCard(place) {
      selected = place;
      $('selection-title').textContent = place.title;
      const kind = $('selection-kind');
      kind.textContent = place.kind ? core.kindLabel(place.kind, lang) : '';
      kind.hidden = !place.kind;
      $('selection-coords').textContent = core.formatCoords(place.lat, place.lon);
      card.hidden = false;
      resultsEl.hidden = true;
      stateEl.hidden = true;
      sheet.dataset.expanded = 'true';
      refreshSheetVisibility();
    }
    function setHash(place) {
      try { history.replaceState(null, '', core.buildPlaceHash(place.lat, place.lon, place.title)); } catch (_) { /* ignore */ }
    }
    function clearHash() {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* ignore */ }
    }
    function selectPlace(raw) {
      // A pending debounced or in-flight search must not redraw the list over the card after selection.
      clearTimeout(debounceTimer); clearTimeout(retryTimer);
      controller?.abort(); seq++;
      const place = {lat: raw.lat, lon: raw.lon, kind: raw.kind, title: core.displayName(raw, lang) || tr('place'), raw};
      placeMarker([place.lon, place.lat]);
      showCard(place);
      setHash(place);
      input.value = place.title;
      clearBtn.hidden = false;
      setExpanded(false);
      map.flyTo({center: [place.lon, place.lat], zoom: Math.max(core.zoomForKind(place.kind), 0), essential: false});
      $('coords').textContent = core.formatCoords(place.lat, place.lon);
    }
    function closeCard() {
      card.hidden = true;
      selected = null;
      if (marker) marker.remove();
      marker = null;
      clearHash();
      if (items.length && core.isSearchable(input.value)) { resultsEl.hidden = false; setExpanded(true); }
      refreshSheetVisibility();
    }
    $('selection-close').addEventListener('click', closeCard);

    map.on('click', event => {
      input.blur();
      const names = map.queryRenderedFeatures(event.point, {layers: ['place-labels', 'street-labels'].filter(l => map.getLayer(l))})
        .map(f => f.properties?.['name:' + lang] || f.properties?.name).filter(Boolean);
      const place = {lat: event.lngLat.lat, lon: event.lngLat.lng, kind: '', title: names[0] || tr('selectedPoint')};
      placeMarker([place.lon, place.lat]);
      showCard(place);
      setHash(place);
      setStatus(place.title + ' · ' + core.formatCoords(place.lat, place.lon));
    });
    const copyText = async (text, okMessage) => {
      try { await navigator.clipboard.writeText(text); setStatus(okMessage); return true; }
      catch (_) { setStatus(tr('copyFailed'), true); return false; }
    };
    $('copy-place').addEventListener('click', () => selected && copyText(core.formatCoords(selected.lat, selected.lon), tr('copied')));
    $('share-place').addEventListener('click', async () => {
      if (!selected) return;
      const url = location.origin + location.pathname + core.buildPlaceHash(selected.lat, selected.lon, selected.title);
      if (navigator.share) {
        try { await navigator.share({title: selected.title, url}); return; }
        catch (error) { if (error?.name === 'AbortError') return; }
      }
      copyText(url, tr('linkCopied'));
    });

    // ---- search ---------------------------------------------------------------------------
    const client = searchBase ? core.createSearchClient({baseUrl: searchBase}) : null;
    let items = [], active = -1, seq = 0, controller = null, debounceTimer = null, retryTimer = null;
    const DEBOUNCE_MS = 300;

    function setExpanded(open) {
      input.setAttribute('aria-expanded', String(open && !resultsEl.hidden));
    }
    function showState(kind, text, opts = {}) {
      stateEl.replaceChildren();
      stateEl.className = 'state' + (kind === 'error' ? ' error' : kind === 'warn' ? ' warn' : '');
      if (kind === 'loading') {
        const spinner = document.createElement('span'); spinner.className = 'spinner'; stateEl.append(spinner);
      }
      const body = document.createElement('div'); body.className = 'grow';
      body.textContent = text;
      if (opts.hint) { const small = document.createElement('small'); small.textContent = opts.hint; body.append(small); }
      stateEl.append(body);
      if (opts.retry) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'btn'; button.textContent = tr('retry');
        button.addEventListener('click', opts.retry);
        stateEl.append(button);
      }
      stateEl.hidden = false;
      refreshSheetVisibility();
    }
    function hideState() { stateEl.hidden = true; refreshSheetVisibility(); }
    function showSkeleton() {
      resultsEl.replaceChildren();
      resultsEl.className = 'results skeleton';
      resultsEl.removeAttribute('role');
      for (let i = 0; i < 4; i++) {
        const li = document.createElement('li');
        li.innerHTML = '<i class="dot"></i><i class="line"></i>';
        resultsEl.append(li);
      }
      resultsEl.hidden = false;
      card.hidden = true;
      refreshSheetVisibility();
    }
    function renderResults() {
      resultsEl.replaceChildren();
      resultsEl.className = 'results';
      resultsEl.setAttribute('role', 'listbox');
      active = -1;
      input.removeAttribute('aria-activedescendant');
      items.forEach((raw, index) => {
        const li = document.createElement('li');
        li.id = 'opt-' + index;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        const pin = document.createElement('span');
        pin.className = 'pin';
        pin.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/></svg>';
        const text = document.createElement('span'); text.className = 'result-text';
        const name = document.createElement('span'); name.className = 'result-name'; name.textContent = core.displayName(raw, lang);
        const sub = document.createElement('span'); sub.className = 'result-sub';
        sub.textContent = core.kindLabel(raw.kind, lang) + ' · ' + raw.lat.toFixed(4) + ', ' + raw.lon.toFixed(4);
        text.append(name, sub);
        li.append(pin, text);
        li.addEventListener('click', () => selectPlace(raw));
        li.addEventListener('mousemove', () => setActive(index, false));
        resultsEl.append(li);
      });
      resultsEl.hidden = !items.length;
      setExpanded(items.length > 0);
      refreshSheetVisibility();
    }
    function setActive(index, scroll = true) {
      const options = resultsEl.querySelectorAll('[role="option"]');
      if (!options.length) return;
      active = (index + options.length) % options.length;
      options.forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
      input.setAttribute('aria-activedescendant', options[active].id);
      if (scroll) options[active].scrollIntoView({block: 'nearest'});
    }
    function resetSearch() {
      clearTimeout(debounceTimer); clearTimeout(retryTimer);
      controller?.abort(); seq++;
      items = []; active = -1;
      resultsEl.hidden = true; stateEl.hidden = true;
      setExpanded(false);
      refreshSheetVisibility();
    }
    async function runSearch(query) {
      if (!client) { showState('warn', tr('notConfigured')); return; }
      controller?.abort();
      clearTimeout(retryTimer);
      const mine = ++seq;
      controller = new AbortController();
      if (!items.length || resultsEl.hidden) showSkeleton();
      hideState();
      try {
        const results = await client.search(query, {
          limit: 10, signal: controller.signal, lang, center: map.getCenter(),
          onSlow: () => { if (mine === seq) showState('warn', tr('waking')); },
        });
        if (mine !== seq) return; // a newer query superseded this one
        items = results;
        hideState();
        if (!results.length) {
          resultsEl.hidden = true;
          showState('info', tr('noResults'), {hint: tr('noResultsHint')});
          return;
        }
        renderResults();
        setStatus(tr('resultsCount', {n: results.length}));
      } catch (error) {
        if (mine !== seq || error.code === 'aborted') return;
        items = []; resultsEl.hidden = true;
        if (error.code === 'rate_limited') {
          let left = error.retryAfter;
          const tick = () => {
            showState('warn', tr('rateLimited', {n: left}));
            if (left-- > 0) retryTimer = setTimeout(tick, 1000); else { hideState(); runSearch(query); }
          };
          tick();
        } else if (error.code === 'not_configured') {
          showState('warn', tr('notConfigured'));
        } else if (error.code === 'bad_request') {
          hideState(); refreshSheetVisibility();
        } else {
          showState('error', error.code === 'unavailable' ? tr('unavailable') : tr('failed'), {retry: () => runSearch(query)});
        }
      }
    }
    function scheduleSearch(immediate) {
      clearTimeout(debounceTimer);
      const query = core.normalizeQuery(input.value);
      clearBtn.hidden = !input.value;
      if (!core.isSearchable(query)) { resetSearch(); return; }
      if (immediate) runSearch(query); else debounceTimer = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    }
    input.addEventListener('input', () => {
      if (!card.hidden) { card.hidden = true; selected = null; if (marker) marker.remove(); marker = null; clearHash(); }
      scheduleSearch(false);
    });
    input.addEventListener('focus', () => {
      if (items.length && resultsEl.hidden && card.hidden && core.isSearchable(input.value)) { renderResults(); }
    });
    $('map-search').addEventListener('submit', event => {
      event.preventDefault();
      if (active >= 0 && items[active]) selectPlace(items[active]);
      else if (items.length && !resultsEl.hidden && core.normalizeQuery(input.value)) selectPlace(items[0]);
      else scheduleSearch(true);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (resultsEl.hidden && items.length) renderResults();
        if (!items.length) return;
        event.preventDefault();
        setActive(active < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : active + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Escape') {
        event.preventDefault(); // type=search would otherwise clear the field natively on the first press
        if (!resultsEl.hidden || !stateEl.hidden) { resultsEl.hidden = true; stateEl.hidden = true; setExpanded(false); refreshSheetVisibility(); }
        else if (input.value) { input.value = ''; clearBtn.hidden = true; resetSearch(); }
      }
    });
    clearBtn.addEventListener('click', () => {
      input.value = ''; clearBtn.hidden = true; resetSearch();
      if (!card.hidden) closeCard();
      input.focus();
    });
    document.addEventListener('keydown', event => {
      if (event.key === '/' && document.activeElement !== input && !event.ctrlKey && !event.metaKey && !event.altKey &&
          !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) { event.preventDefault(); input.focus(); input.select(); }
    });

    // ---- coordinates, geolocation ------------------------------------------------------------------
    const coords = $('coords'), copy = $('copy-coords');
    const updateCoords = () => { const {lng, lat} = map.getCenter(); coords.textContent = core.formatCoords(lat, lng); };
    map.on('moveend', updateCoords);
    updateCoords();
    copy.addEventListener('click', async () => {
      if (await copyText(coords.textContent, tr('copied'))) {
        const label = copy.textContent; copy.textContent = tr('copied') + ' ✓';
        setTimeout(() => { copy.textContent = label; }, 1500);
      }
    });
    $('locate').addEventListener('click', () => {
      if (!navigator.geolocation) { setStatus(tr('geoUnsupported'), true); return; }
      setStatus(tr('locating'), true);
      // The position is used only to move the map; it is never sent to any server or stored.
      navigator.geolocation.getCurrentPosition(({coords: position}) => {
        const point = [position.longitude, position.latitude];
        if (userMarker) userMarker.remove();
        userMarker = new maplibregl.Marker({color: '#2563eb'}).setLngLat(point).addTo(map);
        map.flyTo({center: point, zoom: 15, essential: false});
        setStatus(tr('located'));
      }, error => {
        setStatus(error.code === 1 ? tr('geoDenied') : tr('geoFailed'), true);
      }, {enableHighAccuracy: true, timeout: 12000, maximumAge: 30000});
    });

    applyLanguage();
    if (initialPlace) {
      const place = {lat: initialPlace.lat, lon: initialPlace.lng, kind: '', title: initialPlace.name || tr('selectedPoint')};
      placeMarker([place.lon, place.lat]);
      showCard(place);
    }
    map.on('load', () => { applyLanguage(); applyMapTheme(); setStatus(tr('mapLoaded')); });
    map.on('error', e => { setStatus('Ошибка карты: ' + (e.error?.message || 'проверьте тайлы'), true); });
  } catch (error) {
    setStatus('Карта не настроена: ' + error.message, true);
  }
})();

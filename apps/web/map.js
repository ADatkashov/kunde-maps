/* KUNDE Maps web: self-hosted Kazakhstan PMTiles via MapLibre + real Search API integration. */
(async function () {
  const core = window.KundeCore;
  const nav = window.KundeNav;
  const Shell = window.KundeShell;
  const Icons = window.KundeIcons;
  const $ = id => document.getElementById(id);
  const status = $('status');
  if (!core || !nav || !Shell || !Icons || !window.KundeShellUI) { status.textContent = 'Карта не настроена: core.js или nav.js не загружен'; return; }
  const root = document.documentElement;

  // ---- tiny helpers -------------------------------------------------------------------------
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* private mode */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (_) { /* private mode */ } },
  };
  // Local settings (device only): units, low-power mode, search history switch, 3D buildings.
  let settings = Shell.parseSettings(store.get('kunde-settings'));
  if (store.get('kunde-settings') == null && Shell.suggestLowPower(navigator)) settings.lowPower = true;   // weak devices start without heavy effects
  core.setUnits(settings.units); nav.setNavUnits(settings.units);
  document.body.classList.toggle('low-power', settings.lowPower);
  const persistSettings = () => store.set('kunde-settings', JSON.stringify(settings));
  let searchHistory = settings.history ? Shell.parseHistory(store.get('kunde-history')) : [];
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
    const routingBase = core.parseConfigUrl(config.routingUrl, true);
    const lightUrl = new URL(config.styleUrl, window.location.href);
    if (!['http:', 'https:'].includes(lightUrl.protocol)) throw new Error('Invalid style URL');
    // The dark style lives next to the light one (style.json -> style-dark.json) unless configured explicitly.
    const darkUrl = config.darkStyleUrl ? new URL(config.darkStyleUrl, window.location.href)
      : new URL(lightUrl.href.replace(/style\.json(?=($|\?))/, 'style-dark.json'));
    const prefersDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : {matches: false};
    const currentTheme = () => (root && root.dataset && root.dataset.theme) || (prefersDark.matches ? 'dark' : 'light');

    function prepareStyle(style) {
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
      return style;
    }
    const baseStyles = {};
    async function loadBaseStyle(theme) {
      if (!baseStyles[theme]) {
        const response = await fetch(theme === 'dark' ? darkUrl : lightUrl);
        if (!response.ok) throw new Error('Map style unavailable');
        baseStyles[theme] = prepareStyle(await response.json());
      }
      return baseStyles[theme];
    }
    // Places (Phase 3): a clustered GeoJSON source. It is injected into every style we pass to setStyle, otherwise a theme or
    // language switch would remove it. `placesData` always holds the latest results.
    const BUILDING_UNKNOWN_HEIGHT = 5;   // OpenMapTiles fills render_height with this default when OSM has neither height nor levels: that is "unknown", not a measurement
    let placesData = {type: 'FeatureCollection', features: []};
    let routeData = {type: 'FeatureCollection', features: []};
    let navData = {type: 'FeatureCollection', features: []};   // travelled / remaining parts of the route during navigation
    const BUILDING_HEIGHT_FILTER = ['all', ['has', 'render_height'], ['>', ['get', 'render_height'], BUILDING_UNKNOWN_HEIGHT], ['!=', ['get', 'hide_3d'], true]];
    let placesMode = null; // 'viewport' | 'nearby' | null; drives the tile-POI-dot visibility in localizedStyle
    function withPlaces(style, theme) {
      const dark = theme === 'dark';
      const stroke = dark ? '#0b1220' : '#ffffff';
      // Optional 3D buildings (off by default, never in low-power mode): only buildings whose tile record carries a real height
      // (OpenMapTiles render_height from OSM height / building:levels) are extruded; everything else stays the flat footprint.
      if (Shell.buildingsEnabled(settings)) {
        const at = style.layers.findIndex(l => l.id === 'buildings');
        const source = at >= 0 && style.layers[at].source;
        if (source) style.layers.splice(at + 1, 0, {id: 'buildings-3d', type: 'fill-extrusion', source, 'source-layer': 'building', minzoom: 15, filter: BUILDING_HEIGHT_FILTER,
          paint: {'fill-extrusion-color': dark ? '#3a4352' : '#d8d3c8', 'fill-extrusion-height': ['get', 'render_height'], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.86, 'fill-extrusion-vertical-gradient': true}});
      }
      style.sources.route = {type: 'geojson', data: routeData};
      style.layers.push(
        {id: 'route-casing', type: 'line', source: 'route', layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {
          'line-color': stroke, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 5, 16, 12], 'line-opacity': 0.9}},
        {id: 'route-alt', type: 'line', source: 'route', filter: ['==', ['get', 'active'], false], layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {
          'line-color': dark ? '#94a3b8' : '#64748b', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 16, 6], 'line-opacity': 0.85}},
        {id: 'route-line', type: 'line', source: 'route', filter: ['==', ['get', 'active'], true], layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {
          'line-color': dark ? '#7aa2f7' : '#2563eb', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.5, 16, 7]}});
      style.sources.navroute = {type: 'geojson', data: navData};
      style.layers.push(
        {id: 'nav-casing', type: 'line', source: 'navroute', layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {
          'line-color': stroke, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 7, 18, 20], 'line-opacity': 0.95}},
        {id: 'nav-done', type: 'line', source: 'navroute', filter: ['==', ['get', 'part'], 'done'], layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {
          'line-color': dark ? '#64748b' : '#94a3b8', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 18, 12], 'line-opacity': 0.9}},
        {id: 'nav-left', type: 'line', source: 'navroute', filter: ['==', ['get', 'part'], 'left'], layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {
          'line-color': dark ? '#7aa2f7' : '#2563eb', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4.5, 18, 13]}});
      style.sources.places = {type: 'geojson', data: placesData, cluster: true, clusterRadius: 46, clusterMaxZoom: 15};
      style.layers.push(
        {id: 'places-clusters', type: 'circle', source: 'places', filter: ['has', 'point_count'], paint: {
          'circle-color': dark ? '#5b8def' : '#2563eb', 'circle-radius': ['step', ['get', 'point_count'], 17, 10, 21, 50, 26],
          'circle-stroke-width': 3, 'circle-stroke-color': stroke, 'circle-opacity': 0.95}},
        {id: 'places-cluster-count', type: 'symbol', source: 'places', filter: ['has', 'point_count'], layout: {
          'text-field': ['to-string', ['get', 'point_count_abbreviated']], 'text-font': ['Open Sans Semibold'], 'text-size': 13,
          'text-allow-overlap': true}, paint: {'text-color': dark ? '#0b1220' : '#ffffff'}},
        {id: 'places-points', type: 'circle', source: 'places', filter: ['!', ['has', 'point_count']], paint: {
          'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 9],
          'circle-stroke-width': 2, 'circle-stroke-color': stroke}},
        {id: 'places-selected', type: 'circle', source: 'places', filter: ['==', ['get', 'key'], ''], paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 15], 'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 3, 'circle-stroke-color': dark ? '#7aa2f7' : '#2563eb'}});
      return style;
    }
    // Label templates for every UI language live in layer metadata ("kunde:text", generated by scripts/build-style.py).
    function localizedStyle(base, code) {
      const style = JSON.parse(JSON.stringify(base));
      // Glyphs are fetched by web workers, which cannot resolve relative URLs: make the self-hosted path absolute.
      if (typeof style.glyphs === 'string' && style.glyphs.startsWith('/')) style.glyphs = window.location.origin + style.glyphs;
      for (const layer of style.layers || []) {
        const template = layer.metadata && layer.metadata['kunde:text'];
        if (template && template[code]) layer.layout['text-field'] = template[code];
      }
      if (placesMode) { // our clustered markers replace the tile POI dots (same data, no double dots); POI names stay
        for (const layer of style.layers) if (layer.id === 'poi-dots' || layer.id === 'poi-dots-other') (layer.layout = layer.layout || {}).visibility = 'none';
      }
      return withPlaces(style, (base.metadata && base.metadata['kunde:theme']) || 'light');
    }
    const style = await loadBaseStyle(currentTheme());
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
      container: 'map', style: localizedStyle(style, lang),
      center: initialPlace ? [initialPlace.lng, initialPlace.lat] : [76.945, 43.238],
      zoom: initialPlace ? 15 : 11, attributionControl: {compact: true},
    });

    // ---- theme (UI tokens via CSS; map via the generated light/dark style files) --------------------------
    function syncThemeColor() {
      document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
        m.content = currentTheme() === 'dark' ? '#0d1015' : '#f6f8fb';
        m.removeAttribute('media');
      });
      const dark = currentTheme() === 'dark';
      $('theme').replaceChildren(Icons.node(dark ? 'moon' : 'sun'));
    }
    // diff:true keeps the vector source and tiles; only changed paint/layout properties are applied.
    async function applyMapStyle() {
      const base = await loadBaseStyle(currentTheme());
      map.setStyle(localizedStyle(base, lang), {diff: true});
      syncThemeColor();
    }
    const reportStyleError = error => setStatus('Ошибка карты: ' + error.message, true);
    const themeMode = () => (root.dataset && root.dataset.theme) || 'system';
    function setThemeMode(mode) {
      if (mode === 'system') { delete root.dataset.theme; store.remove('kunde-theme'); }
      else { root.dataset.theme = mode; store.set('kunde-theme', mode); }
      applyMapStyle().catch(reportStyleError);
      renderProfile();
    }
    $('theme').addEventListener('click', () => setThemeMode(currentTheme() === 'dark' ? 'light' : 'dark'));
    if (prefersDark.addEventListener) prefersDark.addEventListener('change', () => { if (!root.dataset.theme) applyMapStyle().catch(reportStyleError); });

    // ---- language ---------------------------------------------------------------------------
    const LANG_BUTTON = {ru: 'RU', kk: 'ҚАЗ', en: 'EN'};
    function applyLanguage() {
      root.lang = lang;
      $('language').firstChild.textContent = LANG_BUTTON[lang];
      $('search-query').placeholder = Shell.shellT(lang, 'searchPlaceholder');
      $('search-label').textContent = tr('searchLabel');
      $('search-clear').setAttribute('aria-label', tr('clear'));
      $('search-results').setAttribute('aria-label', tr('results'));
      for (const [id, key] of [['language', 'language'], ['theme', 'theme']]) {
        $(id).setAttribute('aria-label', tr(key));
        $(id).title = tr(key);
      }
      $('share-place').querySelector('span').textContent = tr('share');
      $('route-place').querySelector('span').textContent = tr('route');
      $('save-place').querySelector('span').textContent = tr('save');
      $('copy-place').textContent = tr('copyCoords');
      $('selection-close').setAttribute('aria-label', tr('close'));
      $('copy-coords').textContent = tr('copyCoords').split(' ')[0];
      shellUi.labels();
    }
    // Everything that shows text or distances is rebuilt here (language and unit changes).
    function relocalize() {
      applyLanguage();
      buildChips(); renderFavorites(); renderRecent(); buildQuickCats(); renderLayers(); renderProfile();
      if (placesMode) renderPlacesList(placesInfo);
      if (items.length && !resultsEl.hidden) renderResults();
      if (navUi && navUi.active) navUi.setLang();
      else if (routeOpen) { renderRouteLabels(); buildRoute(); } else if (selected) showCard(selected);
    }
    function setLang(code) {
      if (!core.LANGS.includes(code) || code === lang) return;
      lang = code;
      store.set('kunde-lang', lang);
      applyMapStyle().catch(reportStyleError);
      relocalize();
      setStatus(tr('langChanged'));
    }
    $('language').addEventListener('click', () => setLang(core.LANGS[(core.LANGS.indexOf(lang) + 1) % core.LANGS.length]));

    // ---- sheet / panel plumbing ---------------------------------------------------------------
    const sheet = $('sheet'), stateEl = $('search-state'), resultsEl = $('search-results');
    const input = $('search-query'), clearBtn = $('search-clear'), card = $('selection');
    const chipsEl = $('chips'), placesPanel = $('places-panel'), placesList = $('places-list'), placesStateEl = $('places-state');
    const favPanel = $('favorites-panel'), favList = $('favorites-list'), favBtn = $('favorites-btn');
    const homePanel = $('home-panel'), profilePanel = $('profile-panel'), navigatorPanel = $('navigator-panel'), tabbar = $('tabbar');
    let resumeFavorites = false;   // a card opened from the saved list returns to it when closed
    let favOpen = false, profileOpen = false, navPanelOpen = false, navTabActive = false, placeItems = [];
    const routePanel = $('route-panel');
    let routeOpen = false;
    const activeCats = new Set();
    const isMobile = () => window.matchMedia('(max-width: 719px)').matches;
    // --sheet-h = the bottom area covered by sheet + tab bar (map attribution, toasts and tools stay above it)
    const syncSheetHeight = () => {
      const mobile = isMobile();
      const kbInset = parseFloat(root.style.getPropertyValue('--kb')) || 0;
      const covered = mobile ? sheet.offsetHeight + (document.body.classList.contains('kb-open') ? 0 : tabbar.offsetHeight) + kbInset : 0;
      root.style.setProperty('--sheet-h', covered + 'px');
      root.style.setProperty('--topbar-b', Math.round($('topbar').getBoundingClientRect().bottom) + 'px');
    };
    if (window.ResizeObserver) { const ro = new ResizeObserver(syncSheetHeight); ro.observe(sheet); ro.observe(tabbar); }
    window.addEventListener('resize', syncSheetHeight);
    const tabOrder = () => routeOpen ? (navTabActive ? 'navigator' : 'route') : (!card.hidden || !resultsEl.hidden || !stateEl.hidden) ? 'search' : favOpen ? 'favorites' : profileOpen ? 'profile' : navPanelOpen ? 'navigator' : 'search';
    const shellUi = window.KundeShellUI.create({getLang: () => lang, tr, onTab: name => openTab(name)});
    // One panel at a time: card > search results/messages > route > saved places > profile > navigator > places list > home.
    function refreshSheetVisibility() {
      const main = !card.hidden || !resultsEl.hidden || !stateEl.hidden;
      const idle = !main && !routeOpen;
      routePanel.hidden = !routeOpen;
      favPanel.hidden = !(favOpen && idle);
      profilePanel.hidden = !(profileOpen && idle && !favOpen);
      navigatorPanel.hidden = !(navPanelOpen && idle && !favOpen && !profileOpen);
      const other = favOpen || profileOpen || navPanelOpen;
      placesPanel.hidden = !(placesMode && idle && !other);
      homePanel.hidden = !(idle && !other && !placesMode);
      sheet.hidden = false;
      const key = !card.hidden ? 'card' : main ? 'results' : routeOpen ? 'route' : favOpen ? 'favorites' : profileOpen ? 'profile' : navPanelOpen ? 'navigator' : placesMode ? 'places' : 'home';
      shellUi.setContent(key, key === 'home' ? 'collapsed' : 'half');
      shellUi.setTab(tabOrder());
      syncSheetHeight();
    }
    // Tabs: search (map, categories) | directions (route planner) | navigator (existing navigation mode) | saved | profile (local settings).
    function openTab(name) {
      if (navUi && navUi.active) return;
      const wasSearch = tabOrder() === 'search' && homePanel && !homePanel.hidden;
      if (name !== 'route' && name !== 'navigator' && routeOpen) closeRoute(false);
      navTabActive = false;
      if (name === 'route') {
        favOpen = profileOpen = navPanelOpen = false; favBtn.setAttribute('aria-pressed', 'false');
        if (!routeOpen) { if (selected && routeClient) openRoute(); else openRouteBlank(); }
        else refreshSheetVisibility();
        return;
      }
      if (name === 'navigator') {
        favOpen = profileOpen = false; favBtn.setAttribute('aria-pressed', 'false');
        if (routeOpen && routes.length && routes[routeActive]) {      // a route is ready: show it, GPS starts only when the user presses Start
          navTabActive = true; refreshSheetVisibility();
          shellUi.apply('half');
          const start = $('route-start'); if (start && !start.closest('[hidden]')) { start.scrollIntoView({block: 'nearest'}); start.focus(); }
          return;
        }
        if (routeOpen) closeRoute(false);
        navPanelOpen = true; renderNavigatorPanel(); refreshSheetVisibility();
        return;
      }
      favOpen = name === 'favorites'; profileOpen = name === 'profile'; navPanelOpen = false;
      favBtn.setAttribute('aria-pressed', String(favOpen));
      if (name === 'favorites' || name === 'profile') {
        if (!card.hidden) closeCard();
        resultsEl.hidden = true; stateEl.hidden = true; setExpanded(false);
        if (name === 'favorites') renderFavorites(); else renderProfile();
      }
      if (name === 'search' && wasSearch) { input.focus(); }
      refreshSheetVisibility();
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
      if (routeOpen) closeRoute(false);
      favOpen = profileOpen = navPanelOpen = false; favBtn.setAttribute('aria-pressed', 'false'); resumeFavorites = false;
      selected = place;
      const poi = place.poi || null;
      // Records keep their raw data so a language switch re-localizes an open card.
      $('selection-title').textContent = poi ? core.poiTitle(poi, lang) : (place.raw ? (core.displayName(place.raw, lang) || tr('place')) : place.title);
      const kind = $('selection-kind');
      let kindText = poi ? core.placeKindLabel(poi, lang) : (place.kind ? core.kindLabel(place.kind, lang) : '');
      if (poi && (kindText === core.poiTitle(poi, lang) || kindText === core.categoryLabel(poi.category, lang))) kindText = ''; // already shown as title or chip
      if (!poi && place.raw && place.raw.locality) kindText = kindText ? kindText + ' · ' + place.raw.locality : place.raw.locality;
      kind.textContent = kindText;
      kind.hidden = !kindText;
      $('selection-coords').textContent = core.formatCoords(place.lat, place.lon);
      renderCardExtras(place);
      card.hidden = false;
      resultsEl.hidden = true;
      stateEl.hidden = true;
      refreshSheetVisibility();
    }
    function svg(path) {
      const el = document.createElement('span');
      el.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
      return el.firstChild;
    }
    const ICONS = {
      address: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
      phone: '<path d="M6.5 4h3l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7L16 13l4 1.5v3a2 2 0 0 1-2 2A14 14 0 0 1 4.5 6a2 2 0 0 1 2-2Z"/>',
      website: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.4 5.2 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.2-3.4-8.5s1-6.1 3.4-8.5Z"/>',
      brand: '<path d="M4 9.5 12 4l8 5.5V20H4V9.5ZM9 20v-6h6v6"/>',
      distance: Icons.get('route'),
    };
    function detailRow(icon, label, contentNode) {
      const row = document.createElement('div');
      const dt = document.createElement('dt'); dt.title = label; dt.append(svg(ICONS[icon]));
      const dd = document.createElement('dd'); dd.append(contentNode);
      row.append(dt, dd);
      return row;
    }
    function linkNode(href, text) {
      const a = document.createElement('a');
      a.href = href; a.textContent = text; a.rel = 'noopener noreferrer';
      if (href.startsWith('http')) a.target = '_blank';
      return a;
    }
    // Only fields that exist in OSM are rendered; nothing is invented or shown as "n/a".
    function renderCardExtras(place) {
      const poi = place.poi || null;
      const chip = $('selection-chip');
      chip.hidden = !poi;
      if (poi) { chip.textContent = core.categoryLabel(poi.category, lang); chip.style.setProperty('--c', core.CATEGORY_COLORS[poi.category]); }
      const open = $('selection-open');
      const label = poi && poi.hours ? core.openLabel(poi.hours, lang) : null;
      open.hidden = !label;
      if (label) { open.textContent = label.label; open.className = 'open-badge ' + label.state; }
      const dl = $('selection-details');
      dl.replaceChildren();
      if (poi) {
        if (poi.distance != null && Number.isFinite(poi.distance)) dl.append(detailRow('distance', Shell.shellT(lang, 'distanceWord'), document.createTextNode(core.formatDistance(poi.distance, lang))));
        if (poi.address) dl.append(detailRow('address', tr('address'), document.createTextNode(poi.address)));
        const tel = poi.phone && core.telHref(poi.phone);
        if (poi.phone) dl.append(detailRow('phone', tr('phone'), tel ? linkNode(tel, poi.phone.split(/[;,]/)[0].trim()) : document.createTextNode(poi.phone)));
        if (poi.website) dl.append(detailRow('website', tr('website'), linkNode(poi.website, new URL(poi.website).hostname.replace(/^www\./, ''))));
        if (poi.brand) dl.append(detailRow('brand', tr('brand'), document.createTextNode(poi.brand)));
      }
      const hours = $('selection-hours');
      hours.hidden = !(poi && poi.hours);
      if (poi && poi.hours) {
        const table = core.hoursTable(poi.hours, lang);
        const body = hours.querySelector('tbody');
        body.replaceChildren();
        hours.querySelector('summary').textContent = table ? tr('hours') : tr('hoursOsm');
        const old = hours.querySelector('.raw'); if (old) old.remove();
        hours.querySelector('table').hidden = !table;
        if (table) {
          const today = (new Date().getDay() + 6) % 7; // local weekday as a Monday-first index (display highlight only)
          table.forEach((row, i) => {
            const tr_ = document.createElement('tr');
            if (i === today) tr_.className = 'today';
            const a = document.createElement('td'); a.textContent = row.day;
            const b = document.createElement('td'); b.textContent = row.text || tr('closedNow');
            tr_.append(a, b); body.append(tr_);
          });
        } else {
          const raw = document.createElement('p'); raw.className = 'raw'; raw.textContent = poi.hours; hours.append(raw);
        }
      }
      const route = $('route-place');
      route.hidden = !routeClient;   // without our own routing API there is no route button (no external map fallback)
      route.title = tr('routeTitle');
      route.querySelector('span').textContent = tr('route');
      syncSaveButton();
      $('share-place').querySelector('span').textContent = tr('share');
      $('copy-place').textContent = tr('copyCoords');
    }
    function setHash(place, mode) {
      const id = (place.poi && place.poi.id) || (place.raw && place.raw.placeId) || null;
      try { history.replaceState(null, '', core.buildPlaceHash(place.lat, place.lon, place.title, id, mode)); } catch (_) { /* ignore */ }
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
      rememberQuery(place.title);
      setExpanded(false);
      flyToPlace(place.lon, place.lat, Math.max(core.zoomForKind(place.kind), 0));
      $('coords').textContent = core.formatCoords(place.lat, place.lon);
      // A hit that is a real place (OSM id) opens the full card: hours, phone, website ... when OSM has them.
      if (raw.placeId && placesClient) {
        placesClient.details(raw.placeId).then(poi => {
          if (selected && selected.raw === raw) { selected.poi = poi; showCard(selected); }
        }).catch(() => { /* the basic card stays; details are optional */ });
      }
    }
    // On phones the bottom sheet covers the lower part of the map: keep the place visible above it.
    function flyToPlace(lon, lat, zoom) {
      // phones: keep the place above the sheet; desktop: keep it clear of the left sidebar
      const padding = {top: 0, left: isMobile() ? 0 : Math.min(430, window.innerWidth * 0.4), right: 0, bottom: isMobile() ? Math.min(sheet.offsetHeight, window.innerHeight * 0.62) : 0};
      map.flyTo({center: [lon, lat], zoom, padding, essential: false});
    }
    function selectPoi(poi, {fly = true} = {}) {
      clearTimeout(debounceTimer); controller?.abort(); seq++;
      const place = {lat: poi.lat, lon: poi.lon, kind: poi.subtype, title: core.poiTitle(poi, lang), poi};
      placeMarker([place.lon, place.lat]);
      showCard(place);
      setHash(place);
      highlightPlace(poi);
      if (fly) flyToPlace(place.lon, place.lat, Math.max(map.getZoom(), 16));
      $('coords').textContent = core.formatCoords(place.lat, place.lon);
    }
    function closeCard() {
      card.hidden = true;
      if (resumeFavorites) { resumeFavorites = false; favOpen = true; favBtn.setAttribute('aria-pressed', 'true'); renderFavorites(); }
      selected = null;
      highlightPlace(null);
      if (marker) marker.remove();
      marker = null;
      clearHash();
      if (items.length && core.isSearchable(input.value)) { resultsEl.hidden = false; setExpanded(true); }
      refreshSheetVisibility();
    }
    $('selection-close').addEventListener('click', closeCard);

    map.on('click', event => {
      input.blur();
      if (pickingStart) { setRouteStart({lat: event.lngLat.lat, lon: event.lngLat.lng, kind: 'map'}); return; }
      if (map.queryRenderedFeatures(event.point, {layers: ['places-points', 'places-clusters']}).length) return; // handled below
      const labelLayers = ((map.getStyle && map.getStyle().layers) || []).filter(l => l.metadata && l.metadata['kunde:text']).map(l => l.id);
      const names = map.queryRenderedFeatures(event.point, {layers: labelLayers})
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
      const url = location.origin + location.pathname + core.buildPlaceHash(selected.lat, selected.lon, selected.title,
        (selected.poi && selected.poi.id) || (selected.raw && selected.raw.placeId) || null);
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
        sub.textContent = core.kindLabel(raw.kind, lang) + ' · ' + (raw.locality || (raw.lat.toFixed(4) + ', ' + raw.lon.toFixed(4)));
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
      if (isMobile() && !homePanel.hidden && shellUi.snap === 'collapsed') shellUi.apply('half');
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

    // ---- places & POI (Phase 3) --------------------------------------------------------------------------
    const placesClient = searchBase ? core.createPlacesClient({baseUrl: searchBase}) : null;
    const MIN_PLACES_ZOOM = 11, MAX_BBOX_DEG = 1.45;
    let placesAbort = null, placesTimer = null, placesSeq = 0, nearbyOrigin = null;

    function featureKey(p, i) { return p.id || 'c' + i; }
    function setPlacesData(list) {
      placeItems = list;
      placesData = {type: 'FeatureCollection', features: list.map((p, i) => ({
        type: 'Feature', geometry: {type: 'Point', coordinates: [p.lon, p.lat]},
        properties: {key: featureKey(p, i), idx: i, color: core.CATEGORY_COLORS[p.category], category: p.category}}))};
      const source = map.getSource && map.getSource('places');
      if (source && source.setData) source.setData(placesData);
    }
    function highlightPlace(poi) {
      const index = poi ? placeItems.findIndex(p => p.id && p.id === poi.id) : -1;
      const key = index >= 0 ? featureKey(placeItems[index], index) : '';
      try { if (map.getLayer && map.getLayer('places-selected')) map.setFilter('places-selected', ['==', ['get', 'key'], key]); } catch (_) { /* style reloading */ }
    }

    // chips: the main categories first, "More" reveals the rest (all are real Places API categories)
    const MAIN_CATS = ['restaurant', 'cafe', 'shop', 'pharmacy', 'fuel', 'hotel', 'parking', 'bank'];
    let chipsMore = false;
    const catLabel = id => id === 'hotel' ? Shell.shellT(lang, 'qcHotel') : id === 'bank' ? Shell.shellT(lang, 'catBank') : core.categoryLabel(id, lang);
    function makeChip(id, extra) {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'chip' + (extra ? ' extra' : ''); chip.dataset.category = id;
      chip.style.setProperty('--c', core.CATEGORY_COLORS[id]);
      chip.setAttribute('aria-pressed', String(activeCats.has(id)));
      chip.append(Icons.node(id), document.createTextNode(catLabel(id)));
      chip.addEventListener('click', () => toggleCategory(id));
      return chip;
    }
    function buildChips() {
      chipsEl.replaceChildren();
      chipsEl.setAttribute('aria-label', tr('chipsLabel'));
      const near = document.createElement('button');
      near.type = 'button'; near.id = 'chip-near'; near.className = 'chip action';
      near.append(Icons.node('locate'), document.createTextNode(tr('nearMe')));
      near.setAttribute('aria-pressed', String(placesMode === 'nearby'));
      near.addEventListener('click', nearMe);
      chipsEl.append(near);
      for (const id of MAIN_CATS.filter(c => core.CATEGORIES.includes(c))) chipsEl.append(makeChip(id, false));
      const rest = core.CATEGORIES.filter(c => !MAIN_CATS.includes(c));
      for (const id of rest) { const chip = makeChip(id, true); chip.hidden = !(chipsMore || activeCats.has(id)); chipsEl.append(chip); }
      const more = document.createElement('button');
      more.type = 'button'; more.id = 'chip-more'; more.className = 'chip more';
      more.setAttribute('aria-expanded', String(chipsMore));
      more.append(Icons.node('more'), document.createTextNode(Shell.shellT(lang, chipsMore ? 'fewerCategories' : 'qcMore')));
      more.addEventListener('click', () => { chipsMore = !chipsMore; buildChips(); if (chipsMore) { const first = chipsEl.querySelector('.chip.extra'); if (first) first.scrollIntoView({inline: 'nearest', block: 'nearest'}); } });
      chipsEl.append(more);
    }
    function syncChips() {
      chipsEl.querySelectorAll('.chip[data-category]').forEach(chip => {
        chip.setAttribute('aria-pressed', String(activeCats.has(chip.dataset.category)));
        if (chip.classList.contains('extra')) chip.hidden = !(chipsMore || activeCats.has(chip.dataset.category));
      });
      const near = $('chip-near');
      if (near) near.setAttribute('aria-pressed', String(placesMode === 'nearby'));
      document.querySelectorAll('#quick-cats .qcat[data-category]').forEach(b => b.setAttribute('aria-pressed', String(activeCats.has(b.dataset.category))));
    }
    // "Near you" tiles in the sheet: a real Places request around the device position (asked for only on this tap); without a fix, the current map view.
    let quickMore = false;
    function buildQuickCats() {
      shellUi.buildQuick({colors: core.CATEGORY_COLORS, onCategory: quickCategory, onMore: () => { quickMore = !quickMore; buildQuickCats(); },
        extras: quickMore ? core.CATEGORIES.filter(c => !['shop', 'restaurant', 'hotel', 'pharmacy', 'fuel'].includes(c)).map(id => [id, catLabel(id)]) : [], expanded: quickMore});
      syncChips();
    }
    function quickCategory(id) {
      if (activeCats.size === 1 && activeCats.has(id)) { clearPlaces(); return; }
      activeCats.clear(); activeCats.add(id); syncChips();
      const viewportFallback = () => { nearbyOrigin = null; loadViewport(); syncPlacesStyle(); };
      if (nearbyOrigin) { loadNearby(); syncPlacesStyle(); return; }
      if (!navigator.geolocation) { viewportFallback(); return; }
      locate((lat, lon) => { nearbyOrigin = {lat, lon}; if (!placesClient) { placesMode = 'nearby'; showPlacesState('warn', tr('notConfigured')); refreshSheetVisibility(); return; } loadNearby(); syncPlacesStyle(); }, viewportFallback);
    }
    let styledForPlaces = false;
    function syncPlacesStyle() { // swap the tile POI dots in/out only when the mode actually changes
      const want = Boolean(placesMode);
      if (want !== styledForPlaces) { styledForPlaces = want; applyMapStyle().catch(reportStyleError); }
    }
    function toggleCategory(id) {
      if (activeCats.has(id)) activeCats.delete(id); else activeCats.add(id);
      syncChips();
      if (placesMode === 'nearby' && nearbyOrigin) loadNearby();
      else if (activeCats.size) loadViewport();
      else clearPlaces();
      syncPlacesStyle();
    }
    function clearPlaces() {
      placesAbort?.abort(); clearTimeout(placesTimer); placesSeq++;
      activeCats.clear(); placesMode = null; nearbyOrigin = null;
      setPlacesData([]);
      highlightPlace(null);
      syncChips();
      refreshSheetVisibility();
      syncPlacesStyle();
    }
    $('places-clear').addEventListener('click', clearPlaces);

    // panel
    function showPlacesState(kind, text, opts = {}) {
      placesStateEl.replaceChildren();
      placesStateEl.className = 'state' + (kind === 'error' ? ' error' : kind === 'warn' ? ' warn' : '');
      if (kind === 'loading') { const sp = document.createElement('span'); sp.className = 'spinner'; placesStateEl.append(sp); }
      const body = document.createElement('div'); body.className = 'grow'; body.textContent = text;
      if (opts.hint) { const small = document.createElement('small'); small.textContent = opts.hint; body.append(small); }
      placesStateEl.append(body);
      if (opts.retry) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn'; button.textContent = tr('retry');
        button.addEventListener('click', opts.retry); placesStateEl.append(button);
      }
      placesStateEl.hidden = false;
    }
    function placeRow(place, index) {
      const li = document.createElement('li');
      li.className = 'place';
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'row';
      const pin = document.createElement('span');
      pin.className = 'pin cat'; pin.style.setProperty('--c', core.CATEGORY_COLORS[place.category]);
      pin.append(svg('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>'));
      const text = document.createElement('span'); text.className = 'result-text';
      const name = document.createElement('span'); name.className = 'result-name'; name.textContent = core.poiTitle(place, lang);
      const sub = document.createElement('span'); sub.className = 'result-sub';
      const title = core.poiTitle(place, lang), kindLabel = core.placeKindLabel(place, lang);
      const parts = title === kindLabel ? [] : [kindLabel]; // an unnamed object is already titled by its kind
      if (place.distance != null) parts.push(core.formatDistance(place.distance, lang));
      sub.append(document.createTextNode(parts.join(' · ')));
      const status = place.hours ? core.openLabel(place.hours, lang) : null;
      if (status) {
        const badge = document.createElement('span'); badge.className = 'open-badge ' + status.state;
        badge.textContent = status.label; sub.append(document.createTextNode(' · '), badge);
      }
      text.append(name, sub);
      row.append(pin, text);
      row.addEventListener('click', () => selectPoi(place));
      li.append(row);
      return li;
    }
    let placesInfo = {};
    function renderPlacesList(info = {}) {
      placesInfo = info;
      placesList.replaceChildren();
      $('places-title').textContent = (placesMode === 'nearby' ? tr('nearMe') : tr('inThisArea')) + ' · ' + placeItems.length;
      $('places-clear').textContent = tr('clearFilters');
      placeItems.forEach((place, index) => placesList.append(placeRow(place, index)));
      if (!placeItems.length) showPlacesState('info', placesMode === 'nearby' ? tr('nearbyEmpty') : tr('placesEmpty'), {hint: tr('placesEmptyHint')});
      else if (info.truncated) { showPlacesState('info', tr('placesTruncated')); }
      else placesStateEl.hidden = true;
      refreshSheetVisibility();
    }
    function placesFailure(error, retry) {
      if (error.code === 'aborted') return;
      setPlacesData([]); placesList.replaceChildren();
      if (error.code === 'rate_limited') showPlacesState('warn', tr('rateLimited', {n: error.retryAfter}));
      else if (error.code === 'bad_request') showPlacesState('info', tr('zoomToSee'));
      else if (error.code === 'not_found' || error.code === 'unavailable' && error.status === 503) showPlacesState('warn', tr('placesUnavailable'), {retry});
      else showPlacesState('error', tr('placesFailed'), {retry});
      refreshSheetVisibility();
    }

    // loading
    function viewportTooWide(bounds) {
      return bounds.getEast() - bounds.getWest() > MAX_BBOX_DEG || bounds.getNorth() - bounds.getSouth() > MAX_BBOX_DEG;
    }
    function scheduleViewportPlaces() { clearTimeout(placesTimer); placesTimer = setTimeout(loadViewport, 350); }
    async function loadViewport() {
      if (!placesClient) { showPlacesState('warn', tr('notConfigured')); placesMode = 'viewport'; refreshSheetVisibility(); return; }
      if (!activeCats.size) return;
      placesMode = 'viewport';
      placesAbort?.abort();
      const bounds = map.getBounds();
      if (map.getZoom() < MIN_PLACES_ZOOM || viewportTooWide(bounds)) {
        setPlacesData([]); placesList.replaceChildren();
        $('places-title').textContent = tr('inThisArea'); $('places-clear').textContent = tr('clearFilters');
        showPlacesState('info', tr('zoomToSee')); refreshSheetVisibility();
        return;
      }
      const mine = ++placesSeq;
      placesAbort = new AbortController();
      if (!placeItems.length) { showPlacesState('loading', tr('searching')); refreshSheetVisibility(); }
      try {
        const result = await placesClient.viewport({
          bbox: {west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth()},
          categories: [...activeCats], center: map.getCenter(), signal: placesAbort.signal,
          onSlow: () => { if (mine === placesSeq) showPlacesState('warn', tr('waking')); },
        });
        if (mine !== placesSeq || placesMode !== 'viewport') return;
        setPlacesData(result.places);
        renderPlacesList(result);
      } catch (error) { if (mine === placesSeq) placesFailure(error, loadViewport); }
    }
    async function loadNearby() {
      if (!placesClient || !nearbyOrigin) return;
      placesMode = 'nearby';
      placesAbort?.abort();
      const mine = ++placesSeq;
      placesAbort = new AbortController();
      showPlacesState('loading', tr('searching')); refreshSheetVisibility();
      try {
        const result = await placesClient.nearby({lat: nearbyOrigin.lat, lon: nearbyOrigin.lon, radius: 1500, categories: [...activeCats], signal: placesAbort.signal,
          onSlow: () => { if (mine === placesSeq) showPlacesState('warn', tr('waking')); }});
        if (mine !== placesSeq || placesMode !== 'nearby') return;
        setPlacesData(result.places);
        renderPlacesList(result);
        syncChips();
      } catch (error) { if (mine === placesSeq) placesFailure(error, loadNearby); }
    }
    map.on('moveend', () => { if (placesMode === 'viewport') scheduleViewportPlaces(); });

    // map interaction with markers and clusters
    map.on('click', 'places-clusters', event => {
      const feature = event.features && event.features[0];
      const source = map.getSource('places');
      if (!feature || !source) return;
      Promise.resolve(source.getClusterExpansionZoom(feature.properties.cluster_id)).then(zoom => {
        map.easeTo({center: feature.geometry.coordinates, zoom: Math.min(zoom + 0.5, 17), essential: false});
      }).catch(() => map.easeTo({center: feature.geometry.coordinates, zoom: map.getZoom() + 2, essential: false}));
    });
    map.on('click', 'places-points', event => {
      const feature = event.features && event.features[0];
      const place = feature && placeItems[feature.properties.idx];
      if (place) selectPoi(place, {fly: false});
    });
    for (const layer of ['places-clusters', 'places-points']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }

    // favorites (device-local; no account, nothing leaves the browser)
    let favorites = core.parseFavorites(store.get('kunde-favorites'));
    function favoriteOf(place) {
      const poi = place.poi, raw = place.raw;
      return {
        id: (poi && poi.id) || (raw && raw.placeId) || null,
        name: poi ? poi.name : (raw ? raw.name : place.title), nameRu: poi ? poi.nameRu : raw && raw.nameRu,
        nameKk: poi ? poi.nameKk : raw && raw.nameKk, nameEn: poi ? poi.nameEn : raw && raw.nameEn,
        category: poi ? poi.category : (raw && raw.category) || null, subtype: poi ? poi.subtype : (place.kind || ''),
        lat: place.lat, lon: place.lon, address: poi ? poi.address : null,
      };
    }
    function syncSaveButton() {
      const button = $('save-place');
      if (!button) return;
      const saved = Boolean(selected) && core.isFavorite(favorites, favoriteOf(selected));
      button.setAttribute('aria-pressed', String(saved));
      button.querySelector('span').textContent = saved ? tr('saved') : tr('save');
    }
    function renderFavorites() {
      $('favorites-title').textContent = tr('favorites');
      $('favorites-note').textContent = tr('favoritesNote');
      $('favorites-close').setAttribute('aria-label', tr('close'));
      favList.replaceChildren();
      $('favorites-empty').textContent = tr('favoritesEmpty');
      $('favorites-empty').hidden = favorites.length > 0;
      for (const item of favorites) {
        const li = document.createElement('li'); li.className = 'fav';
        const open = document.createElement('button'); open.type = 'button'; open.className = 'row grow';
        const pin = document.createElement('span'); pin.className = 'pin cat'; pin.style.setProperty('--c', core.CATEGORY_COLORS[item.category] || '#2563eb');
        pin.append(svg(ICONS.address));
        const text = document.createElement('span'); text.className = 'result-text';
        const name = document.createElement('span'); name.className = 'result-name'; name.textContent = core.favoriteTitle(item, lang);
        const sub = document.createElement('span'); sub.className = 'result-sub';
        sub.textContent = item.category ? core.placeKindLabel(item, lang) : (item.subtype ? core.kindLabel(item.subtype, lang) : core.formatCoords(item.lat, item.lon));
        text.append(name, sub); open.append(pin, text);
        open.addEventListener('click', () => openFavorite(item));
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button plain fav-remove';
        remove.setAttribute('aria-label', tr('remove')); remove.title = tr('remove');
        remove.append(svg('<path d="M6 6l12 12M18 6 6 18"/>'));
        remove.addEventListener('click', () => { favorites = core.toggleFavorite(favorites, item).list; core.parseFavorites; persistFavorites(); renderFavorites(); syncSaveButton(); setStatus(tr('removedToast')); });
        li.append(open, remove); favList.append(li);
      }
    }
    function persistFavorites() { store.set('kunde-favorites', JSON.stringify(favorites)); }
    function openFavorite(item) {
      const poi = item.id && item.category ? {...item, hours: null, phone: null, website: null, brand: null, distance: null} : null;
      if (poi) {
        selectPoi(poi);
        resumeFavorites = true;
        if (placesClient) placesClient.details(item.id).then(full => { if (selected && selected.poi && selected.poi.id === item.id) { const keep = resumeFavorites; selected.poi = full; showCard(selected); resumeFavorites = keep; } }).catch(() => {});
      } else {
        const place = {lat: item.lat, lon: item.lon, kind: item.subtype, title: core.favoriteTitle(item, lang)};
        placeMarker([place.lon, place.lat]); showCard(place); setHash(place); resumeFavorites = true;
        map.flyTo({center: [place.lon, place.lat], zoom: 15, essential: false});
      }
    }
    $('save-place').addEventListener('click', () => {
      if (!selected) return;
      const result = core.toggleFavorite(favorites, favoriteOf(selected));
      favorites = result.list; persistFavorites(); syncSaveButton(); renderFavorites();
      setStatus(result.saved ? tr('savedToast') : tr('removedToast'));
    });
    favBtn.setAttribute('aria-pressed', 'false');
    $('favorites-close').addEventListener('click', () => { favOpen = false; favBtn.setAttribute('aria-pressed', 'false'); refreshSheetVisibility(); });

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
    function locate(onFix, onFail) {
      if (!navigator.geolocation) { shellUi.setLocateState('error'); setStatus(tr('geoUnsupported'), true); if (onFail) onFail(); return; }
      setStatus(tr('locating'), true);
      shellUi.setLocateState('busy');
      // The fix moves the map. Only "Nearby" sends it (rounded to ~100 m) to the Places API; it is never logged or stored.
      navigator.geolocation.getCurrentPosition(({coords: position}) => {
        const point = [position.longitude, position.latitude];
        if (userMarker) userMarker.remove();
        const dot = document.createElement('div'); dot.className = 'user-dot'; dot.innerHTML = '<span></span>';
        userMarker = new maplibregl.Marker({element: dot}).setLngLat(point).addTo(map);
        map.flyTo({center: point, zoom: 15, essential: false});
        shellUi.setLocateState('ok', position.accuracy);
        setStatus(tr('located'));
        if (onFix) onFix(position.latitude, position.longitude);
      }, error => {
        shellUi.setLocateState(error.code === 1 ? 'denied' : 'error');
        setStatus(error.code === 1 ? tr('geoDenied') : tr('geoFailed'), true);
        if (onFail) onFail(error);
      }, {enableHighAccuracy: true, timeout: 12000, maximumAge: 30000});
    }
    function nearMe() {
      locate((lat, lon) => {
        nearbyOrigin = {lat, lon};
        if (!placesClient) { placesMode = 'nearby'; showPlacesState('warn', tr('notConfigured')); refreshSheetVisibility(); return; }
        loadNearby().then(() => setStatus(tr('geoNearbyNote')));
        syncPlacesStyle();
      });
    }
    $('locate').addEventListener('click', () => locate());
    // Permission state is read without prompting (the browser asks only when the user taps the button).
    try {
      if (navigator.permissions && navigator.permissions.query) navigator.permissions.query({name: 'geolocation'}).then(result => {
        const sync = () => { if (result.state === 'denied') shellUi.setLocateState('denied'); else if ($('locate').dataset.state === 'denied') shellUi.setLocateState('idle'); };
        sync(); result.onchange = sync;
      }).catch(() => {});
    } catch (_) { /* optional */ }
    shellUi.setLocateState('idle');

    // ---- map tools: zoom, compass, layers ---------------------------------------------------------------------
    $('zoom-in').addEventListener('click', () => (typeof map.zoomIn === 'function' ? map.zoomIn() : map.easeTo({zoom: map.getZoom() + 1})));
    $('zoom-out').addEventListener('click', () => (typeof map.zoomOut === 'function' ? map.zoomOut() : map.easeTo({zoom: map.getZoom() - 1})));
    const compassBtn = $('compass');
    const syncCompass = () => { const b = typeof map.getBearing === 'function' ? map.getBearing() : 0; compassBtn.hidden = Math.abs(b) < 1; };
    map.on('rotate', syncCompass);
    compassBtn.addEventListener('click', () => { if (typeof map.resetNorth === 'function') map.resetNorth(); else map.easeTo({bearing: 0}); });
    function renderLayers() {
      shellUi.setSwitch($('layer-3d'), Shell.buildingsEnabled(settings), Shell.shellT(lang, 'layer3d'), Shell.shellT(lang, 'layer3dNote'), settings.lowPower);
      shellUi.setSwitch($('layer-low'), settings.lowPower, Shell.shellT(lang, 'layerLow'), Shell.shellT(lang, 'layerLowNote'));
      shellUi.labels();
    }
    function apply3D() {
      applyMapStyle().catch(reportStyleError);
      const on = Shell.buildingsEnabled(settings);
      if (typeof map.easeTo === 'function' && !(navUi && navUi.active)) map.easeTo({pitch: on ? 50 : 0, essential: false});
    }
    function setLowPower(on) {
      const had3d = Shell.buildingsEnabled(settings);
      settings.lowPower = Boolean(on);
      document.body.classList.toggle('low-power', settings.lowPower);
      persistSettings(); renderLayers(); renderProfile();
      if (had3d !== Shell.buildingsEnabled(settings)) apply3D();
    }
    $('layer-3d').addEventListener('click', () => {
      if (settings.lowPower) return;
      settings.buildings3d = !settings.buildings3d; persistSettings(); renderLayers(); apply3D();
    });
    $('layer-low').addEventListener('click', () => setLowPower(!settings.lowPower));

    // ---- recent searches (device-local, can be switched off and cleared in the profile) ------------------------------
    function rememberQuery(text) {
      if (!settings.history) return;
      searchHistory = Shell.addHistory(searchHistory, text);
      store.set('kunde-history', JSON.stringify(searchHistory));
      renderRecent();
    }
    function renderRecent() {
      const list = $('recent-list');
      list.replaceChildren();
      list.setAttribute('aria-label', Shell.shellT(lang, 'recent'));
      const show = settings.history && searchHistory.length > 0;
      $('recent').hidden = !show;
      if (!show) return;
      for (const q of searchHistory) {
        const li = document.createElement('li'); li.className = 'place';
        const row = document.createElement('button'); row.type = 'button'; row.className = 'row';
        const pin = document.createElement('span'); pin.className = 'pin'; pin.append(Icons.node('clock'));
        const text = document.createElement('span'); text.className = 'result-text';
        const name = document.createElement('span'); name.className = 'result-name'; name.textContent = q;
        text.append(name); row.append(pin, text);
        row.addEventListener('click', () => { input.value = q; clearBtn.hidden = false; scheduleSearch(true); });
        li.append(row); list.append(li);
      }
    }
    $('recent-clear').addEventListener('click', () => { searchHistory = []; store.remove('kunde-history'); renderRecent(); setStatus(Shell.shellT(lang, 'clearDataDone')); });

    // ---- profile: local settings only (no accounts exist) ---------------------------------------------------------
    const LANG_NAMES = {ru: 'Русский', kk: 'Қазақша', en: 'English'};
    function setUnitsPref(units) {
      settings.units = units; persistSettings();
      core.setUnits(units); nav.setNavUnits(units);
      relocalize();
    }
    function setHistoryPref(on) {
      settings.history = Boolean(on); persistSettings();
      if (!on) { searchHistory = []; store.remove('kunde-history'); setStatus(Shell.shellT(lang, 'historyOff')); }
      else searchHistory = Shell.parseHistory(store.get('kunde-history'));
      renderRecent(); renderProfile();
    }
    function clearLocalData() {
      for (const key of ['kunde-favorites', 'kunde-history', 'kunde-settings', 'kunde-theme', 'kunde-lang']) store.remove(key);
      favorites = []; searchHistory = []; settings = Shell.parseSettings(null);
      core.setUnits('metric'); nav.setNavUnits('metric');
      document.body.classList.toggle('low-power', false);
      delete root.dataset.theme; lang = 'ru';
      applyMapStyle().catch(reportStyleError);
      relocalize(); syncSaveButton(); apply3D();
      setStatus(Shell.shellT(lang, 'clearDataDone'));
    }
    function renderProfile() {
      shellUi.renderProfile({lang, themeMode: themeMode(), settings, langNames: LANG_NAMES,
        handlers: {language: setLang, theme: setThemeMode, units: setUnitsPref}});
      shellUi.setSwitch($('set-low'), settings.lowPower, Shell.shellT(lang, 'layerLow'), Shell.shellT(lang, 'layerLowNote'));
      shellUi.setSwitch($('set-history'), settings.history, Shell.shellT(lang, 'setHistory'), Shell.shellT(lang, 'setHistoryNote'));
    }
    $('set-low').addEventListener('click', () => setLowPower(!settings.lowPower));
    $('set-history').addEventListener('click', () => setHistoryPref(!settings.history));
    $('clear-data').addEventListener('click', () => shellUi.dialog({title: Shell.shellT(lang, 'clearData'), body: Shell.shellT(lang, 'clearDataConfirm'),
      ok: Shell.shellT(lang, 'delete'), cancel: Shell.shellT(lang, 'cancel'), danger: true, onOk: clearLocalData}));

    // ---- navigator tab: entry to the existing navigation mode ---------------------------------------------------
    function renderNavigatorPanel() {
      $('navigator-head').textContent = Shell.shellT(lang, 'navNoRoute');
      $('navigator-hint').textContent = Shell.shellT(lang, 'navNoRouteHint');
      const action = $('navigator-action'); action.textContent = Shell.shellT(lang, 'navBuild');
    }
    $('navigator-action').addEventListener('click', () => openTab('route'));

    // ---- quick actions in the sheet -----------------------------------------------------------------------------------
    $('qa-route').addEventListener('click', () => openTab('route'));
    $('qa-drive').addEventListener('click', () => { if (!routeClient) { setStatus(tr('notConfigured')); return; } openRouteBlank('car'); });
    $('qa-fav').addEventListener('click', () => openTab('favorites'));
    $('qa-add').addEventListener('click', () => shellUi.dialog({title: Shell.shellT(lang, 'addTitle'), body: Shell.shellT(lang, 'addBody'), ok: Shell.shellT(lang, 'ok'),
      link: {label: Shell.shellT(lang, 'addOsm'), href: 'https://www.openstreetmap.org/'}}));

    // ---- routing (Phase 4) -------------------------------------------------------------------------------------
    // Both ends are editable (type an address/place, use the device position once, or tap the map). The device position is used for the one
    // request only (sent to our routing API, never stored or logged). Without a configured routing API the button stays an external link.
    const routeClient = routingBase ? core.createRouteClient({baseUrl: routingBase}) : null;
    function setNavData(collection) {
      navData = collection;
      const source = map.getSource && map.getSource('navroute');
      if (source && source.setData) source.setData(navData);
    }
    // Phase 5 navigation: GPS session + HUD. Rerouting reuses the same routing client (one request at a time, no alternatives).
    const navUi = routeClient && window.KundeNavUI ? window.KundeNavUI.create({map, maplibregl, nav, getLang: () => lang, setNavData,
      fetchRoute: req => routeClient.route({from: req.from, to: req.to, mode: req.mode, lang: req.lang, alternatives: false, signal: req.signal, onSlow: req.onSlow}),
      onExit: () => { if (routeOpen) closeRoute(true); }}) : null;
    let routeFrom = null, routeDest = null, routeMode = 'car', routeAbort = null, pickingStart = false, routes = [], routeActive = 0, pinFrom = null, pinTo = null;
    const routeStateEl = $('route-state'), routeStepsEl = $('route-steps'), stepsWrap = $('route-steps-wrap'), routeSummaryEl = $('route-summary'), routeOptionsEl = $('route-options');
    const fromInput = $('route-from'), toInput = $('route-to');

    function setRouteData(list, active) {
      routeData = {type: 'FeatureCollection', features: (list || []).map((r, i) => ({type: 'Feature', properties: {active: i === active},
        geometry: {type: 'LineString', coordinates: r.coordinates}}))};
      const source = map.getSource && map.getSource('route');
      if (source && source.setData) source.setData(routeData);
    }
    function pinElement(letter, cls) {
      const el = document.createElement('div'); el.className = 'route-pin ' + cls;
      const span = document.createElement('span'); span.textContent = letter; el.append(span);
      return el;
    }
    function updatePins() {
      for (const [pin, point, letter, cls] of [[pinFrom, routeFrom, 'A', 'a'], [pinTo, routeDest, 'B', 'b']]) if (pin) pin.remove();
      pinFrom = pinTo = null;
      if (!routeOpen) return;
      if (routeFrom) pinFrom = new maplibregl.Marker({element: pinElement('A', 'a'), anchor: 'bottom'}).setLngLat([routeFrom.lon, routeFrom.lat]).addTo(map);
      if (routeDest) pinTo = new maplibregl.Marker({element: pinElement('B', 'b'), anchor: 'bottom'}).setLngLat([routeDest.lon, routeDest.lat]).addTo(map);
    }
    const pointLabel = p => !p ? '' : p.kind === 'me' ? tr('myLocation') : p.kind === 'place' ? p.title : core.formatCoords(p.lat, p.lon);
    function renderRouteLabels(force) {
      $('route-title').textContent = tr('routeTitle');
      $('route-from-label').textContent = tr('routeStart');
      $('route-to-label').textContent = tr('routeEnd');
      $('route-close').setAttribute('aria-label', tr('routeClose'));
      $('route-pick').setAttribute('aria-label', tr('pickOnMap')); $('route-pick').title = tr('pickOnMap');
      $('route-locate').setAttribute('aria-label', tr('routeUseMyLocation')); $('route-locate').title = tr('routeUseMyLocation');
      $('route-swap').setAttribute('aria-label', tr('routeSwap')); $('route-swap').title = tr('routeSwap');
      routeStepsEl.setAttribute('aria-label', tr('routeSteps'));
      $('route-steps-summary').textContent = tr('routeSteps');
      routeOptionsEl.setAttribute('aria-label', tr('routeAlt'));
      $('route-note').textContent = tr('routeNote');
      for (const button of document.querySelectorAll('#route-modes .mode')) {
        const label = document.createElement('span'); label.textContent = tr({car: 'modeCar', foot: 'modeFoot', bike: 'modeBike'}[button.dataset.mode]);
        button.replaceChildren(Icons.node({car: 'car', foot: 'walk', bike: 'bike'}[button.dataset.mode]), label);
      }
      for (const [input, point] of [[fromInput, routeFrom], [toInput, routeDest]]) {
        if (force || document.activeElement !== input) input.value = pointLabel(point);
        input.placeholder = point ? '' : tr('routeSearchPlaceholder');
      }
      if (!routeFrom && document.activeElement !== fromInput) fromInput.placeholder = tr('routeNeedStart');
      $('route-start').querySelector('span').textContent = nav.navT(lang, 'begin');
      $('route-safety').textContent = nav.navT(lang, 'safety') + ' ' + nav.navT(lang, 'limits');
    }
    function showRouteState(kind, text, extra, actions) {
      routeStateEl.replaceChildren();
      routeStateEl.className = 'state' + (kind === 'error' ? ' error' : kind === 'warn' ? ' warn' : '');
      if (kind === 'loading') { const spinner = document.createElement('span'); spinner.className = 'spinner'; routeStateEl.append(spinner); }
      const body = document.createElement('div'); body.className = 'grow'; body.textContent = text;
      if (extra) { const small = document.createElement('small'); small.textContent = extra; body.append(small); }
      routeStateEl.append(body);
      for (const action of actions || []) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn small'; button.textContent = action.label;
        button.addEventListener('click', action.run); routeStateEl.append(button);
      }
      routeStateEl.hidden = false;
    }
    function setPickingStart(on) {
      pickingStart = on;
      document.body.classList.toggle('picking-start', on);
      $('route-pick').setAttribute('aria-pressed', String(on));
      if (on) { showRouteState('info', tr('pickHint')); setStatus(tr('pickHint')); }
    }
    function resetRouteResult(keepPins) {
      routeSummaryEl.hidden = true; stepsWrap.hidden = true; routeStepsEl.replaceChildren();
      routeOptionsEl.hidden = true; routeOptionsEl.replaceChildren();
      $('route-start-row').hidden = true;
      routes = []; routeActive = 0;
      setRouteData(null, 0);
      if (!keepPins) updatePins();
    }

    // Address/place suggestions for both ends (our Search API; the typed text never leaves for any third party).
    function attachSuggest(input, list, onPick) {
      let timer = null, abort = null, shown = [], active = -1;
      const hide = () => { list.hidden = true; list.replaceChildren(); shown = []; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
      const choose = index => { const raw = shown[index]; if (!raw) return; hide(); onPick(raw); };
      const mark = () => {
        [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
        if (active >= 0) input.setAttribute('aria-activedescendant', list.children[active].id); else input.removeAttribute('aria-activedescendant');
      };
      input.addEventListener('input', () => {
        clearTimeout(timer);
        if (abort) abort.abort();
        const text = input.value;
        if (!client || !core.isSearchable(text)) { hide(); return; }
        timer = setTimeout(() => {
          abort = new AbortController();
          const mine = abort;
          const c = map.getCenter();
          client.search(text, {limit: 5, lang, center: {lat: c.lat, lng: c.lng}, signal: mine.signal}).then(found => {
            if (mine !== abort || document.activeElement !== input) return;
            shown = found; list.replaceChildren(); active = -1;
            found.forEach((raw, i) => {
              const li = document.createElement('li'); li.setAttribute('role', 'option'); li.id = list.id + '-' + i; li.setAttribute('aria-selected', 'false');
              const name = document.createElement('span'); name.textContent = core.displayName(raw, lang);
              const small = document.createElement('small'); small.textContent = core.kindLabel(raw.kind, lang) + (raw.locality ? ' · ' + raw.locality : '');
              li.append(name, small);
              li.addEventListener('mousedown', e => { e.preventDefault(); choose(i); });
              list.append(li);
            });
            list.hidden = !found.length;
            input.setAttribute('aria-expanded', String(Boolean(found.length)));
          }).catch(() => {});
        }, 280);
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' && shown.length) { e.preventDefault(); active = (active + 1) % shown.length; mark(); }
        else if (e.key === 'ArrowUp' && shown.length) { e.preventDefault(); active = (active - 1 + shown.length) % shown.length; mark(); }
        else if (e.key === 'Enter' && shown.length) { e.preventDefault(); choose(active >= 0 ? active : 0); }
        else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); hide(); }
      });
      input.addEventListener('focus', () => input.select());
      input.addEventListener('blur', () => { setTimeout(hide, 120); renderRouteLabels(); });
    }
    const pickToPoint = raw => ({lat: raw.lat, lon: raw.lon, kind: 'place', title: core.displayName(raw, lang) || tr('place')});
    attachSuggest(fromInput, $('route-from-list'), raw => { routeFrom = pickToPoint(raw); afterPointsChanged(); });
    attachSuggest(toInput, $('route-to-list'), raw => { routeDest = pickToPoint(raw); afterPointsChanged(); });
    function afterPointsChanged() { renderRouteLabels(true); updatePins(); buildRoute(); }

    function useMyLocation() {
      if (!navigator.geolocation) { setPickingStart(true); return; }
      showRouteState('loading', tr('locating'));
      navigator.geolocation.getCurrentPosition(({coords: position}) => {
        if (!routeOpen) return;
        setRouteStart({lat: position.latitude, lon: position.longitude, kind: 'me'});
      }, () => { if (routeOpen) { showRouteState('warn', tr('geoDenied')); fromInput.focus(); } }, {enableHighAccuracy: true, timeout: 12000, maximumAge: 30000});
    }
    function openRoute() {
      if (!selected || !routeClient) return;
      routeDest = {lat: selected.lat, lon: selected.lon, kind: 'place', title: selected.title};
      routeFrom = null; routeOpen = true; card.hidden = true; favOpen = profileOpen = navPanelOpen = false;
      setHash(selected, routeMode);
      resetRouteResult(); renderRouteLabels(); updatePins(); refreshSheetVisibility(); setExpanded(false);
      useMyLocation();
    }
    // The Directions tab / quick actions: an empty planner (nothing is requested and GPS stays off until the user chooses a start).
    function openRouteBlank(mode) {
      if (!routeClient) { setStatus(tr('notConfigured')); return; }
      if (mode) { routeMode = mode; for (const b of document.querySelectorAll('#route-modes .mode')) b.setAttribute('aria-pressed', String(b.dataset.mode === routeMode)); }
      routeDest = null; routeFrom = null; routeOpen = true; card.hidden = true; favOpen = profileOpen = navPanelOpen = false;
      resultsEl.hidden = true; stateEl.hidden = true; setExpanded(false);
      resetRouteResult(); renderRouteLabels(); updatePins(); refreshSheetVisibility();
      showRouteState('info', Shell.shellT(lang, 'routeBlank'));
      toInput.focus();
    }
    function setRouteStart(point) {
      setPickingStart(false);
      routeFrom = point;
      renderRouteLabels(); updatePins();
      buildRoute();
    }
    const ROUTE_ERRORS = {outside_coverage: 'routeOutside', no_route: 'routeNoRoute', no_road_near_point: 'routeNoRoad', route_too_long: 'routeTooLong', points_too_close: 'routeTooClose'};
    // Route requests: bounded automatic retry with backoff for transient failures (a cold-starting Render service answers 502/503 or times out),
    // never an endless loop; the user always keeps "Retry" and "Edit points" and stays inside KUNDE Maps.
    const ROUTE_RETRY_DELAYS = [4000, 8000];
    let routeRetryTimer = null;
    function buildRoute(attempt = 0) {
      clearTimeout(routeRetryTimer); routeRetryTimer = null;
      if (!routeOpen || !routeDest) return;
      if (routeAbort) routeAbort.abort();
      routeAbort = null;
      if (!routeFrom) { resetRouteResult(true); showRouteState('info', tr('routeNeedStart')); return; }
      routeAbort = new AbortController();
      const mine = routeAbort;
      if (attempt === 0) resetRouteResult(true);
      showRouteState('loading', tr('routeBuilding'));
      const actions = () => [{label: tr('retry'), run: () => buildRoute(0)}, {label: tr('routeEditPoints'), run: () => { fromInput.focus(); }}];
      routeClient.route({from: routeFrom, to: routeDest, mode: routeMode, lang, alternatives: true, signal: mine.signal,
        onSlow: () => showRouteState('loading', tr('routeBuilding'), tr('waking'))})
        .then(route => { if (mine === routeAbort && routeOpen) showRoutes(route); })
        .catch(error => {
          if (error.code === 'aborted' || mine !== routeAbort || !routeOpen) return;
          const key = ROUTE_ERRORS[error.detail];
          if (error.code === 'rate_limited') { showRouteState('warn', tr('rateLimited').replace('{n}', error.retryAfter || 10), null, actions()); return; }
          if (key) { showRouteState('error', tr(key), null, [{label: tr('routeEditPoints'), run: () => { fromInput.focus(); }}]); return; }
          if (error.transient && attempt < ROUTE_RETRY_DELAYS.length) {
            const delay = ROUTE_RETRY_DELAYS[attempt];
            showRouteState('loading', tr('routeRetrying').replace('{n}', Math.round(delay / 1000)), tr('waking'));
            routeRetryTimer = setTimeout(() => { routeRetryTimer = null; if (mine === routeAbort && routeOpen) buildRoute(attempt + 1); }, delay);
            return;
          }
          showRouteState('error', tr(error.transient || error.code === 'unavailable' ? 'routeServiceDown' : 'routeFailed'), null, actions());
        });
    }
    function showRoutes(main) {
      routes = [main, ...main.alternatives];
      routeActive = 0;
      routeStateEl.hidden = true;
      renderOptions();
      selectRoute(0, true);
    }
    function renderOptions() {
      routeOptionsEl.replaceChildren();
      routeOptionsEl.hidden = routes.length < 2;
      const fastest = Math.min(...routes.map(r => r.duration));
      routes.forEach((r, i) => {
        const li = document.createElement('li'); li.tabIndex = 0; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === routeActive));
        const left = document.createElement('div');
        const time = document.createElement('strong'); time.textContent = core.formatDuration(r.duration, lang);
        const label = document.createElement('small'); label.textContent = r.duration === fastest ? tr('routeFastest') : tr('routeVariant').replace('{n}', i + 1);
        left.append(time, label);
        const dist = document.createElement('small'); dist.textContent = core.formatDistance(r.distance, lang);
        li.append(left, dist);
        const go = () => selectRoute(i, false);
        li.addEventListener('click', go);
        li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        routeOptionsEl.append(li);
      });
    }
    function selectRoute(index, fit) {
      routeActive = index;
      const route = routes[index];
      [...routeOptionsEl.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === index)));
      setRouteData(routes, index);
      $('route-total').textContent = core.formatDistance(route.distance, lang) + ' · ' + core.formatDuration(route.duration, lang);
      $('route-narration').textContent = route.narrationLang !== lang ? tr('routeNarrationRu') : '';
      $('route-narration').hidden = route.narrationLang === lang;
      routeSummaryEl.hidden = false;
      routeStepsEl.replaceChildren();
      for (const step of route.steps) {
        const li = document.createElement('li');
        li.tabIndex = 0;
        const text = document.createElement('span'); text.textContent = step.instruction;
        const dist = document.createElement('small'); dist.textContent = step.distance ? core.formatDistance(step.distance, lang) : '';
        li.append(text, dist);
        const go = () => flyToPlace(step.lon, step.lat, 17);
        li.addEventListener('click', go);
        li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        routeStepsEl.append(li);
      }
      stepsWrap.hidden = !route.steps.length;
      $('route-start-row').hidden = !navUi;
      if (fit) stepsWrap.open = !isMobile();  // on a phone the step list starts collapsed so the map stays visible
      if (fit && route.bbox) {
        const all = routes.reduce((b, r) => r.bbox ? [Math.min(b[0], r.bbox[0]), Math.min(b[1], r.bbox[1]), Math.max(b[2], r.bbox[2]), Math.max(b[3], r.bbox[3])] : b, route.bbox);
        const fitNow = () => { const bottom = isMobile() && !sheet.hidden ? Math.min(sheet.offsetHeight, window.innerHeight * 0.62) : 0; map.fitBounds([[all[0], all[1]], [all[2], all[3]]], {padding: {top: isMobile() ? 150 : 90, left: isMobile() ? 40 : 440, right: 40, bottom: bottom + 40}, maxZoom: 17, duration: 800, essential: false}); };
        requestAnimationFrame(() => requestAnimationFrame(fitNow));  // after the panel has its final height
      }
      syncSheetHeight();
      setStatus(core.formatDistance(route.distance, lang) + ' · ' + core.formatDuration(route.duration, lang));
    }
    function closeRoute(restoreCard = true) {
      clearTimeout(routeRetryTimer); routeRetryTimer = null;
      if (routeAbort) routeAbort.abort();
      routeAbort = null; routeOpen = false; navTabActive = false;
      setPickingStart(false);
      resetRouteResult();
      if (restoreCard && selected) { card.hidden = false; setHash(selected); }
      refreshSheetVisibility();
    }
    $('route-close').addEventListener('click', () => closeRoute(true));
    $('route-start').addEventListener('click', () => {
      const route = routes[routeActive];
      if (!navUi || !route || !routeDest) return;
      setRouteData(null, 0);   // the plain route lines give way to the progress layers
      navUi.start({route, destination: {lat: routeDest.lat, lon: routeDest.lon}, mode: route.mode});
    });
    $('route-pick').addEventListener('click', () => setPickingStart(!pickingStart));
    $('route-locate').addEventListener('click', useMyLocation);
    $('route-swap').addEventListener('click', () => {
      if (!routeFrom && !routeDest) return;
      const a = routeFrom, b = routeDest;
      routeFrom = b; routeDest = a;
      renderRouteLabels(); updatePins(); buildRoute();
    });
    for (const button of document.querySelectorAll('#route-modes .mode')) {
      button.addEventListener('click', () => {
        routeMode = button.dataset.mode;
        if (selected && routeOpen) setHash(selected, routeMode);
        for (const other of document.querySelectorAll('#route-modes .mode')) other.setAttribute('aria-pressed', String(other === button));
        buildRoute();
      });
    }
    $('route-place').addEventListener('click', event => {
      if (!routeClient) return; // no routing API configured: the link opens OpenStreetMap directions as before
      event.preventDefault();
      openRoute();
    });

    applyLanguage();
    buildChips();
    renderFavorites();
    renderRecent(); buildQuickCats(); renderLayers(); renderProfile(); renderNavigatorPanel();
    refreshSheetVisibility();
    if (settings.buildings3d && Shell.buildingsEnabled(settings)) apply3D();
    if (initialPlace) {
      const place = {lat: initialPlace.lat, lon: initialPlace.lng, kind: '', title: initialPlace.name || tr('selectedPoint')};
      placeMarker([place.lon, place.lat]);
      showCard(place);
      // A shared link to a real place (#poi=n123) loads its full record; if the API is unreachable the coordinate card stays.
      // A shared link to a real place (#poi=n123) loads its full record first; a route deep link (#route=car) then opens the panel with that
      // place as destination (the start is the viewer's own choice and is never part of a link).
      const openSharedRoute = () => {
        if (!initialPlace.route || !routeClient) return;
        routeMode = initialPlace.route;
        for (const b of document.querySelectorAll('#route-modes .mode')) b.setAttribute('aria-pressed', String(b.dataset.mode === routeMode));
        openRoute();
      };
      if (initialPlace.poi && placesClient) {
        placesClient.details(initialPlace.poi).then(poi => { if (selected === place) selectPoi(poi, {fly: false}); }).catch(() => {}).then(openSharedRoute);
      } else openSharedRoute();
    }
    syncThemeColor();
    map.on('load', () => setStatus(tr('mapLoaded')));
    map.on('error', e => { setStatus('Ошибка карты: ' + (e.error?.message || 'проверьте тайлы'), true); });
  } catch (error) {
    setStatus('Карта не настроена: ' + error.message, true);
  }
})();

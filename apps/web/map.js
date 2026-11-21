/* Self-hosted Kazakhstan PMTiles via MapLibre custom protocol. */
(async function () {
  const status = document.getElementById('status');
  try {
    if (!window.pmtiles || !window.maplibregl) throw new Error('Map libraries unavailable');
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    const response = await fetch('./config.json', {cache:'no-store'});
    if (!response.ok) throw new Error('config.json not found');
    const config = await response.json();
    if (!config.styleUrl) throw new Error('Configure styleUrl in config.json');
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
    // The style remains local; a published archive can live on object storage/CDN.
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
    // Check same-origin archives before creating the map so the preview never
    // reports "loaded" while displaying an empty background.
    for (const source of Object.values(style.sources || {})) {
      if (typeof source.url !== 'string' || !source.url.startsWith('pmtiles://')) continue;
      const tileUrl = new URL(source.url.slice('pmtiles://'.length));
      // Validate remote tile hosts too; CORS must expose Content-Range.
      if (tileUrl.protocol !== 'https:' && !(tileUrl.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(tileUrl.hostname))) {
        throw new Error('PMTiles host must use HTTPS');
      }
      const probe = await fetch(tileUrl.href, {
        method: 'GET',
        headers: { Range: 'bytes=0-15' },
        cache: 'no-store'
      });
      if (probe.status !== 206) {
        throw new Error('PMTiles недоступен (HTTP ' + probe.status + '). Сначала создайте и опубликуйте архив карты.');
      }
      const contentRange = probe.headers.get('content-range') || '';
      if (!/^bytes 0-15\/\d+$/.test(contentRange)) {
        throw new Error('Сервер тайлов не поддерживает корректные HTTP Range-запросы.');
      }
    }
    const map = new maplibregl.Map({
      container:'map', style,
      center:[76.945,43.238], zoom:11, attributionControl:true
    });
    map.addControl(new maplibregl.NavigationControl(),'top-right');
    const coords = document.getElementById('coords');
    const copy = document.getElementById('copy-coords');
    const locate = document.getElementById('locate');
    const language = document.getElementById('language');
    const selection = document.getElementById('selection');
    const selectionTitle = document.getElementById('selection-title');
    const selectionCoords = document.getElementById('selection-coords');
    const selectionClose = document.getElementById('selection-close');
    let currentLanguage = 'ru';
    const labelExpression = lang => ['coalesce', ['get', 'name:' + lang], ['get', 'name'], ''];
    language?.addEventListener('click', () => {
      currentLanguage = currentLanguage === 'ru' ? 'kk' : 'ru';
      for (const layer of ['street-labels', 'place-labels']) {
        if (map.getLayer(layer)) map.setLayoutProperty(layer, 'text-field', labelExpression(currentLanguage));
      }
      language.textContent = currentLanguage === 'ru' ? 'ҚАЗ' : 'РУС';
      language.setAttribute('aria-label', currentLanguage === 'ru' ? 'Переключить подписи на казахский' : 'Переключить подписи на русский');
      status.textContent = currentLanguage === 'kk' ? 'Қазақша атаулар қосылды' : 'Русские названия включены';
    });
    let userMarker = null;
    let selectedMarker = null;
    const updateCoords = () => {
      if (!coords) return;
      const {lng, lat} = map.getCenter();
      coords.textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
    };
    map.on('click', event => {
      if (selectedMarker) selectedMarker.remove();
      selectedMarker = new maplibregl.Marker({color:'#e05b46'})
        .setLngLat(event.lngLat).addTo(map);
      const latitude = event.lngLat.lat.toFixed(5);
      const longitude = event.lngLat.lng.toFixed(5);
      const pointName = map.queryRenderedFeatures(event.point, {layers:['place-labels','street-labels']})
        .map(feature => feature.properties?.['name:' + currentLanguage] || feature.properties?.name)
        .find(Boolean);
      if (selection && selectionTitle && selectionCoords) {
        selection.hidden = false;
        selectionTitle.textContent = pointName || (currentLanguage === 'kk' ? 'Таңдалған нүкте' : 'Выбранная точка');
        selectionCoords.textContent = latitude + ', ' + longitude;
      }
      status.textContent = 'Выбрана точка · ' + latitude + ', ' + longitude;
      if (coords) coords.textContent = latitude + ', ' + longitude;
    });
    selectionClose?.addEventListener('click', () => {
      if (selection) selection.hidden = true;
      if (selectedMarker) selectedMarker.remove();
      selectedMarker = null;
    });
    map.on('moveend', updateCoords);
    updateCoords();
    copy?.addEventListener('click', async () => {
      const value = coords.textContent;
      try {
        await navigator.clipboard.writeText(value);
        copy.textContent = 'Скопировано ✓';
      } catch (_) {
        status.textContent = 'Не удалось скопировать координаты';
      }
    });
    locate?.addEventListener('click', () => {
      if (!navigator.geolocation) {
        status.textContent = 'Геолокация не поддерживается браузером';
        return;
      }
      status.textContent = 'Определяем местоположение…';
      navigator.geolocation.getCurrentPosition(({coords: position}) => {
        const point = [position.longitude, position.latitude];
        if (userMarker) userMarker.remove();
        userMarker = new maplibregl.Marker({color:'#1463f3'}).setLngLat(point).addTo(map);
        map.flyTo({center:point,zoom:15,essential:true});
        status.textContent = 'Местоположение определено';
      }, error => {
        status.textContent = error.code === 1
          ? 'Разрешите доступ к геолокации в браузере'
          : 'Не удалось определить местоположение';
      }, {enableHighAccuracy:true,timeout:12000,maximumAge:30000});
    });
    const searchForm = document.getElementById('map-search');
    const searchQuery = document.getElementById('search-query');
    const searchResults = document.getElementById('search-results');
    // Preview search: only features in loaded vector tiles, not an address geocoder.
    const normalizeName = value => String(value || '').toLocaleLowerCase('ru').trim();
    const nearestPoint = (geometry, center) => {
      if (!geometry || !geometry.coordinates) return null;
      const lines = [];
      if (geometry.type === 'Point') lines.push([geometry.coordinates]);
      else if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') lines.push(geometry.coordinates);
      else if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') lines.push(...geometry.coordinates);
      else if (geometry.type === 'MultiPolygon') {
        for (const polygon of geometry.coordinates) lines.push(...polygon);
      }
      const scale = Math.max(0.1, Math.cos(center.lat * Math.PI / 180));
      const project = p => [(p[0] - center.lng) * scale, p[1] - center.lat];
      let best = null;
      let bestDistance = Infinity;
      for (const line of lines) {
        for (let i = 0; i < line.length; i++) {
          const start = line[i];
          if (!Array.isArray(start) || !Number.isFinite(start[0]) || !Number.isFinite(start[1])) continue;
          let candidate = start;
          if (i + 1 < line.length) {
            const end = line[i + 1];
            if (Array.isArray(end) && Number.isFinite(end[0]) && Number.isFinite(end[1])) {
              const p = project(start), q = project(end);
              const dx = q[0] - p[0], dy = q[1] - p[1];
              const length2 = dx * dx + dy * dy;
              const t = length2 ? Math.max(0, Math.min(1, -(p[0] * dx + p[1] * dy) / length2)) : 0;
              candidate = [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
            }
          }
          const [x, y] = project(candidate);
          const distance = x * x + y * y;
          if (distance < bestDistance) { bestDistance = distance; best = candidate; }
        }
      }
      return best && {point:best, distance:bestDistance};
    };
    searchForm?.addEventListener('submit', async event => {
      event.preventDefault();
      if (!searchQuery || !searchResults) return;
      const needle = normalizeName(searchQuery.value);
      if (needle.length < 2) return;
      searchResults.replaceChildren();
      searchResults.hidden = false;
      const center = map.getCenter();
      let remoteMatches = null;
      if (config.searchUrl) {
        try {
          const endpoint = new URL(config.searchUrl, window.location.href);
          if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname))) {
            throw new Error('Search API requires HTTPS');
          }
          endpoint.searchParams.set('q', searchQuery.value.trim());
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 4000);
          try {
            const response = await fetch(endpoint.href, {signal:controller.signal, mode:'cors'});
            if (!response.ok) throw new Error('Search API HTTP ' + response.status);
            const payload = await response.json();
            if (!Array.isArray(payload.results)) throw new Error('Invalid search response');
            remoteMatches = payload.results
              .filter(item => item && Number.isFinite(item.lon) && Number.isFinite(item.lat) &&
                Math.abs(item.lon) <= 180 && Math.abs(item.lat) <= 90)
              .slice(0, 10)
              .map(item => ({
                name: String(item[currentLanguage === 'kk' ? 'name_kk' : 'name_ru'] || item.name || 'Адрес'),
                point:[item.lon, item.lat], rank:0, distance:0
              }));
          } finally { clearTimeout(timeout); }
        } catch (error) {
          console.warn('Search API unavailable, using loaded map tiles:', error);
          status.textContent = 'Сервер поиска недоступен · поиск по открытой карте';
        }
      }
      const matchesByName = new Map();
      for (const layer of ['place', 'transportation_name']) {
        for (const feature of map.querySourceFeatures('kunde', {sourceLayer:layer})) {
          const properties = feature.properties || {};
          const names = [properties['name:ru'], properties['name:kk'], properties.name].filter(Boolean);
          if (!names.some(name => normalizeName(name).includes(needle))) continue;
          const nearest = nearestPoint(feature.geometry, center);
          if (!nearest) continue;
          const name = properties['name:' + currentLanguage] || properties.name || names[0];
          const key = layer + ':' + normalizeName(name);
          const rank = (normalizeName(name) === needle ? 0 : normalizeName(name).startsWith(needle) ? 1 : 2);
          const match = {name, point:nearest.point, distance:nearest.distance, rank};
          const previous = matchesByName.get(key);
          if (!previous || match.distance < previous.distance) matchesByName.set(key, match);
        }
      }
      const matches = remoteMatches ?? [...matchesByName.values()]
        .sort((a, b) => a.rank - b.rank || a.distance - b.distance)
        .slice(0, 10);
      if (!matches.length) {
        searchResults.textContent = remoteMatches ? 'Совпадений не найдено.' : 'В загруженной области совпадений нет. Переместите карту и попробуйте снова.';
        return;
      }
      for (const match of matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = match.name;
        button.addEventListener('click', () => {
          map.flyTo({center:match.point,zoom:Math.max(map.getZoom(),14),essential:true});
          if (selectedMarker) selectedMarker.remove();
          selectedMarker = new maplibregl.Marker({color:'#e05b46'}).setLngLat(match.point).addTo(map);
          if (selection && selectionTitle && selectionCoords) {
            selection.hidden = false;
            selectionTitle.textContent = match.name;
            selectionCoords.textContent = match.point[1].toFixed(5) + ', ' + match.point[0].toFixed(5);
          }
          if (coords) coords.textContent = match.point[1].toFixed(5) + ', ' + match.point[0].toFixed(5);
          searchResults.hidden = true;
          status.textContent = 'Найдено на карте: ' + match.name;
        });
        searchResults.appendChild(button);
      }
    });
    map.on('load',()=>{status.textContent='Алматы · стиль карты загружен';});
    map.on('error',(e)=>{status.textContent='Ошибка карты: '+(e.error?.message||'проверьте тайлы');});
  } catch (error) {
    status.textContent='Карта не настроена: '+error.message;
  }
})();

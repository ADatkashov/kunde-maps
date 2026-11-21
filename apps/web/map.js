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
    map.on('load',()=>{status.textContent='Алматы · стиль карты загружен';});
    map.on('error',(e)=>{status.textContent='Ошибка карты: '+(e.error?.message||'проверьте тайлы');});
  } catch (error) {
    status.textContent='Карта не настроена: '+error.message;
  }
})();

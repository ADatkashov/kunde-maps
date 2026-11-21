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

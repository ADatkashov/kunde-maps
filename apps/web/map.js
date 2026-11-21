/* Self-hosted Kazakhstan PMTiles via MapLibre custom protocol. */
(async function () {
  const status = document.getElementById('status');
  try {
    if (!window.pmtiles) throw new Error('PMTiles library unavailable');
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    const response = await fetch('./config.json', {cache:'no-store'});
    if (!response.ok) throw new Error('config.json not found');
    const config = await response.json();
    if (!config.styleUrl || !/^https?:\/\//.test(config.styleUrl)) throw new Error('Configure styleUrl in config.json');
    const map = new maplibregl.Map({
      container:'map', style:config.styleUrl,
      center:[76.945,43.238], zoom:11, attributionControl:true
    });
    map.addControl(new maplibregl.NavigationControl(),'top-right');
    map.on('load',()=>{status.textContent='Алматы · стиль карты загружен';});
    map.on('error',(e)=>{status.textContent='Ошибка карты: '+(e.error?.message||'проверьте тайлы');});
  } catch (error) {
    status.textContent='Карта не настроена: '+error.message;
  }
})();

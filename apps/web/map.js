/* KUNDE Maps Foundation: configure a licensed style endpoint before use.
   No third-party tile server is silently used. */
(async function () {
  const status = document.getElementById('status');
  try {
    const response = await fetch('./config.json', {cache:'no-store'});
    if (!response.ok) throw new Error('config.json not found');
    const config = await response.json();
    if (!config.styleUrl || !/^https?:\/\//.test(config.styleUrl)) throw new Error('Configure a valid styleUrl in config.json');
    const map = new maplibregl.Map({
      container:'map', style:config.styleUrl,
      center:[76.945,43.238], zoom:11, attributionControl:true
    });
    map.addControl(new maplibregl.NavigationControl(),'top-right');
    map.on('load',()=>{status.textContent='Алматы · карта загружена';});
    map.on('error',()=>{status.textContent='Ошибка загрузки карты — проверьте tile/style сервер';});
  } catch (error) {
    status.textContent='Карта не настроена: '+error.message;
  }
})();

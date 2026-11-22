/* KUNDE Maps icon set: one original stroke style on a 24 px grid (2 px stroke, round caps). No third-party icon assets.
 * Paths are static strings; user data is never interpolated into them. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KundeIcons = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const P = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8 12 3.5Z"/><path d="m3.5 12.2 8.5 4.5 8.5-4.5"/><path d="m3.5 16.2 8.5 4.3 8.5-4.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    locate: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
    route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
    car: '<path d="M5 16V11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11v5"/><path d="M3.5 16h17v2.5a1 1 0 0 1-1 1H18a1 1 0 0 1-1-1V17.5M6 17.5v1a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V16"/><path d="M5 11h14"/><circle cx="8" cy="14" r=".6"/><circle cx="16" cy="14" r=".6"/>',
    walk: '<circle cx="13" cy="4.6" r="1.8"/><path d="m11 21 1.6-6.2-2.6-2.3 1-4.2 3 1.6 2.4 2.6M10 12.5 8 15.5M9 8.5l-3 1.4"/>',
    bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16 9.5 8H13l5 8M9.5 8 8.4 6H6.5M11.5 12.5h5.7"/>',
    bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3.8L6 20V5a1 1 0 0 1 1-1Z"/>',
    addPlace: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>',
    navigator: '<path d="M12 3.5 19 20l-7-3.6L5 20l7-16.5Z"/>',
    user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/>',
    swap: '<path d="M7 4v14m0 0-3-3m3 3 3-3M17 20V6m0 0-3 3m3-3 3 3"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
    share: '<path d="M12 15V4m0 0L8 8m4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7"/>',
    more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
    arrow: '<path d="M5 12h14m0 0-5-5m5 5-5 5"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    trash: '<path d="M5 7h14M10 4h4M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>',
    // categories
    restaurant: '<path d="M7 3.5v7.2a2 2 0 0 0 2 2V20.5M5 3.5v5M9 3.5v5M17 20.5V3.5c-2.2 1.3-3 4-3 7.2h3"/>',
    cafe: '<path d="M5 9h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9Z"/><path d="M16 10.5h1.5a2 2 0 0 1 0 4H16M8 3.5c0 1.3 1 1.3 1 2.5M12 3.5c0 1.3 1 1.3 1 2.5"/>',
    shop: '<path d="M3.5 4.5h2.3l1.7 9.5h9.2l1.8-6.8H6.6"/><circle cx="9" cy="18.5" r="1.4"/><circle cx="16.5" cy="18.5" r="1.4"/>',
    pharmacy: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>',
    hospital: '<path d="M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4C19 15.6 12 20 12 20Z"/><path d="M12 10.5v4M10 12.5h4"/>',
    school: '<path d="m3 9 9-4.5L21 9l-9 4.5L3 9Z"/><path d="M7 11.5V16c1.4 1.4 3.2 2 5 2s3.6-.6 5-2v-4.5"/>',
    fuel: '<path d="M5.5 20.5V5.5a1.5 1.5 0 0 1 1.5-1.5h5a1.5 1.5 0 0 1 1.5 1.5v15M4.5 20.5h10M13.5 9h2.3a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 0 3 0V9l-2.3-2.3"/><path d="M7.5 7.5h4"/>',
    parking: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M10 16.5V8h3a2.5 2.5 0 0 1 0 5h-3"/>',
    bank: '<path d="M3.5 9.5 12 4l8.5 5.5M5.5 10v7.5M9.5 10v7.5M14.5 10v7.5M18.5 10v7.5M3.5 20h17"/>',
    hotel: '<path d="M3.5 18.5v-11M3.5 15h17v3.5M20.5 15v-3a2.5 2.5 0 0 0-2.5-2.5h-7V15"/><circle cx="7" cy="11.5" r="1.7"/>',
    beauty: '<path d="m12 3.5 1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8 1.8-5Z"/><path d="M18.5 16.5v3M17 18h3"/>',
    sport: '<path d="M6.5 8v8M17.5 8v8M3.5 10v4M20.5 10v4M6.5 12h11"/>',
    culture: '<path d="M3.5 9.5 12 4l8.5 5.5H3.5ZM5.5 11v6.5M9.5 11v6.5M14.5 11v6.5M18.5 11v6.5M3.5 20h17"/>',
    park: '<path d="M12 20.5v-5M12 3.5c-3.6 2.6-5 5.2-5 8 0 2 1.9 3.5 5 3.5s5-1.5 5-3.5c0-2.8-1.4-5.4-5-8Z"/>',
    auto: '<path d="M14.5 6.5a3.5 3.5 0 0 0 4.4 4.4L11 18.8a2 2 0 0 1-2.8-2.8l7.9-7.9"/><path d="m5 6 2 2"/>',
    transport: '<rect x="5" y="4" width="14" height="13" rx="3"/><path d="M5 11.5h14M8 20.5l1-3.5M16 20.5l-1-3.5"/><circle cx="8.5" cy="14.3" r=".6"/><circle cx="15.5" cy="14.3" r=".6"/>',
    services: '<rect x="4" y="8" width="16" height="11" rx="2"/><path d="M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 13h16"/>',
  };
  const get = name => P[name] || P.pin;
  const svg = (name, cls) => '<svg class="' + (cls || 'icon') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + get(name) + '</svg>';
  function node(name, cls) {
    const wrap = document.createElement('span');
    wrap.innerHTML = svg(name, cls);
    return wrap.firstChild;
  }
  return {paths: P, get, svg, node};
});

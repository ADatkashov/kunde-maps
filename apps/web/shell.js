/* KUNDE Maps app shell (Phase 5.5): DOM-free logic for the bottom sheet, tabs, settings and search history, plus the shell strings.
 * Unit-tested in Node (test/shell.test.js); the DOM wiring lives in shell-ui.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KundeShell = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SNAPS = ['collapsed', 'half', 'full'];
  const TABS = ['search', 'route', 'navigator', 'favorites', 'profile'];

  // ---- bottom sheet geometry ---------------------------------------------------------------------------------------------
  // `avail` is the vertical room between the top bar and the tab bar. Heights are CSS pixels of the visible sheet.
  function snapHeights({viewport, topbar = 0, tabbar = 0, peek = 150}) {
    const avail = Math.max(0, viewport - topbar - tabbar);
    const full = Math.max(peek, avail - 8);
    const half = Math.min(full, Math.max(peek + 56, Math.round(avail * 0.46)));
    return {collapsed: Math.min(peek, full), half, full};
  }
  // Release of a drag: a quick flick moves one snap in its direction, otherwise the nearest snap wins.
  // `velocity` is px/ms, positive = the sheet was moving up.
  function snapOnRelease(height, heights, velocity = 0) {
    const order = SNAPS.map(name => [name, heights[name]]);
    if (Math.abs(velocity) > 0.45) {
      const sorted = order.slice().sort((a, b) => a[1] - b[1]);
      if (velocity > 0) { const next = sorted.find(([, h]) => h > height + 8); return next ? next[0] : sorted[sorted.length - 1][0]; }
      const below = sorted.filter(([, h]) => h < height - 8);
      return below.length ? below[below.length - 1][0] : sorted[0][0];
    }
    return order.reduce((best, cur) => (Math.abs(cur[1] - height) < Math.abs(best[1] - height) ? cur : best))[0];
  }
  function stepSnap(current, direction) {
    const i = SNAPS.indexOf(current);
    const base = i < 0 ? 0 : i;
    return SNAPS[Math.max(0, Math.min(SNAPS.length - 1, base + (direction > 0 ? 1 : -1)))];
  }
  const clampHeight = (height, heights) => Math.max(heights.collapsed, Math.min(heights.full, height));

  // ---- search history (device-local, opt-out) -----------------------------------------------------------------------------
  const HISTORY_MAX = 8;
  function parseHistory(raw) {
    try {
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list.filter(q => typeof q === 'string' && q.trim().length >= 2 && q.length <= 100).slice(0, HISTORY_MAX);
    } catch (_) { return []; }
  }
  function addHistory(list, query) {
    const q = String(query || '').replace(/\s+/g, ' ').trim();
    if (q.length < 2 || q.length > 100) return list;
    return [q, ...list.filter(item => item.toLowerCase() !== q.toLowerCase())].slice(0, HISTORY_MAX);
  }

  // ---- local settings ------------------------------------------------------------------------------------------------------
  const DEFAULT_SETTINGS = {history: true, lowPower: false, buildings3d: false, units: 'metric'};
  function parseSettings(raw) {
    const out = {...DEFAULT_SETTINGS};
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === 'object') {
        for (const key of ['history', 'lowPower', 'buildings3d']) if (typeof value[key] === 'boolean') out[key] = value[key];
        if (value.units === 'metric' || value.units === 'imperial') out.units = value.units;
      }
    } catch (_) { /* defaults */ }
    return out;
  }
  // Heavy effects (3D) are never on together with low-power mode; the device hint can also force it.
  const buildingsEnabled = s => Boolean(s.buildings3d && !s.lowPower);
  function suggestLowPower(nav) {
    nav = nav || {};
    const mem = Number(nav.deviceMemory), cores = Number(nav.hardwareConcurrency);
    return (mem > 0 && mem <= 2) || (cores > 0 && cores <= 2);
  }

  // ---- keyboard overlap (virtual keyboard on browsers that do not resize the layout viewport) -----------------------------
  function keyboardInset(innerHeight, vv) {
    if (!vv) return 0;
    const inset = Math.round(innerHeight - vv.height - (vv.offsetTop || 0));
    return inset > 120 ? inset : 0;   // small insets are browser chrome, not a keyboard
  }

  // ---- strings -------------------------------------------------------------------------------------------------------------
  const S = {
    ru: {
      tabsLabel: 'Разделы', tabSearch: 'Поиск', tabRoute: 'Проезд', tabNavigator: 'Навигатор', tabFavorites: 'Избранное', tabProfile: 'Профиль',
      brandHome: 'KUNDE Maps', searchPlaceholder: 'Поиск мест, адресов, маршрутов', sheet: 'Панель', sheetCollapsed: 'Панель свёрнута', sheetHalf: 'Панель наполовину',
      sheetFull: 'Панель развёрнута', sheetHandle: 'Размер панели. Стрелки вверх и вниз меняют высоту',
      qaRoute: 'Маршрут', qaDrive: 'Проезд', qaFavorites: 'Избранное', qaAdd: 'Добавить место', nearYou: 'Рядом с вами', recent: 'Недавние запросы', clearHistory: 'Очистить',
      qcShop: 'Продукты', qcFood: 'Еда', qcHotel: 'Отели', qcPharmacy: 'Аптеки', qcFuel: 'АЗС', qcMore: 'Ещё', allCategories: 'Все категории', fewerCategories: 'Свернуть',
      catBank: 'Банки и банкоматы',
      layers: 'Слои карты', zoomIn: 'Приблизить', zoomOut: 'Отдалить', compass: 'Повернуть на север', locate: 'Моё местоположение',
      locIdle: 'Нажмите, чтобы показать себя на карте', locBusy: 'Определяем…', locOk: 'Точность около {n} м', locDenied: 'Доступ к геолокации запрещён в браузере', locFail: 'Не удалось определить местоположение',
      layersTitle: 'Слои и производительность', layer3d: '3D-здания', layer3dNote: 'Только там, где в данных есть высота зданий; иначе здания плоские.',
      layerLow: 'Экономный режим', layerLowNote: 'Без 3D и анимаций. Включён по умолчанию на слабых устройствах.',
      layerTraffic: 'Пробки', layerTrafficNote: 'Не показываются: у KUNDE Maps пока нет подтверждённого источника данных о движении.',
      addTitle: 'Добавить место', addBody: 'Добавление мест в KUNDE Maps пока недоступно: для него нужны аккаунты и модерация. Данные карты берутся из OpenStreetMap, и там место можно добавить уже сейчас.',
      addOsm: 'Открыть OpenStreetMap', ok: 'Понятно', cancel: 'Отмена',
      navTitle: 'Навигатор', navNoRoute: 'Маршрут ещё не выбран', navNoRouteHint: 'Постройте маршрут, затем нажмите «Начать». GPS включается только после вашего нажатия.',
      navBuild: 'Построить маршрут', navReady: 'Маршрут готов', navReadyHint: 'Проверьте маршрут и нажмите «Начать», чтобы включить GPS.', navOpenRoute: 'Открыть маршрут',
      profile: 'Профиль', profileNote: 'Аккаунтов в KUNDE Maps пока нет. Настройки хранятся только на этом устройстве.',
      setLanguage: 'Язык', setTheme: 'Тема', themeSystem: 'Системная', themeLight: 'Светлая', themeDark: 'Тёмная',
      setUnits: 'Единицы измерения', unitsMetric: 'Километры', unitsImperial: 'Мили',
      setEffects: 'Карта', setHistory: 'Сохранять историю поиска', setHistoryNote: 'Только в памяти этого браузера.',
      privacy: 'Конфиденциальность', privacyBody: 'Избранное, язык, тема и история поиска хранятся только на вашем устройстве. Геолокация включается только по вашему нажатию; точка отправляется на наш сервер только для поиска рядом (с округлением) и построения маршрута, не сохраняется и не логируется.',
      clearData: 'Удалить данные на устройстве', clearDataConfirm: 'Удалить избранное, историю поиска и настройки на этом устройстве?', clearDataDone: 'Данные на устройстве удалены', delete: 'Удалить',
      about: 'О приложении', aboutBody: 'KUNDE Maps — независимая карта Казахстана. Карта, поиск и маршруты построены на данных OpenStreetMap.', aboutLicense: 'Данные: © участники OpenStreetMap, лицензия ODbL.',
      aboutVersion: 'Версия интерфейса {v}', aboutOsm: 'Об авторских правах OpenStreetMap',
      distanceWord: 'Расстояние', routeBlank: 'Укажите, куда едем. Начало можно выбрать на карте или взять по GPS кнопкой.', placeActions: 'Действия с местом',
      historyOff: 'История поиска выключена', themeChanged: 'Тема изменена', dialogClose: 'Закрыть окно', moreCats: 'Другие категории',
    },
    kk: {
      tabsLabel: 'Бөлімдер', tabSearch: 'Іздеу', tabRoute: 'Жол', tabNavigator: 'Навигатор', tabFavorites: 'Таңдаулы', tabProfile: 'Профиль',
      brandHome: 'KUNDE Maps', searchPlaceholder: 'Орындарды, мекенжайларды, бағыттарды іздеу', sheet: 'Панель', sheetCollapsed: 'Панель жиналған', sheetHalf: 'Панель жартылай ашық',
      sheetFull: 'Панель толық ашық', sheetHandle: 'Панель өлшемі. Жоғары және төмен көрсеткілер биіктікті өзгертеді',
      qaRoute: 'Бағыт', qaDrive: 'Жол', qaFavorites: 'Таңдаулы', qaAdd: 'Орын қосу', nearYou: 'Жақын маңда', recent: 'Соңғы сұраулар', clearHistory: 'Тазалау',
      qcShop: 'Азық-түлік', qcFood: 'Тағам', qcHotel: 'Қонақүйлер', qcPharmacy: 'Дәріханалар', qcFuel: 'Жанармай', qcMore: 'Тағы', allCategories: 'Барлық санаттар', fewerCategories: 'Жию',
      catBank: 'Банктер мен банкоматтар',
      layers: 'Карта қабаттары', zoomIn: 'Жақындату', zoomOut: 'Алыстату', compass: 'Солтүстікке бұру', locate: 'Менің орным',
      locIdle: 'Өзіңізді картада көрсету үшін басыңыз', locBusy: 'Анықталуда…', locOk: 'Дәлдігі шамамен {n} м', locDenied: 'Браузерде геолокацияға рұқсат жоқ', locFail: 'Орналасқан жерді анықтау мүмкін болмады',
      layersTitle: 'Қабаттар және өнімділік', layer3d: '3D ғимараттар', layer3dNote: 'Деректерде ғимарат биіктігі бар жерде ғана; әйтпесе ғимараттар жалпақ.',
      layerLow: 'Үнемдеу режимі', layerLowNote: '3D және анимациясыз. Әлсіз құрылғыларда әдепкі бойынша қосулы.',
      layerTraffic: 'Кептеліс', layerTrafficNote: 'Көрсетілмейді: KUNDE Maps-те қозғалыс деректерінің расталған көзі әлі жоқ.',
      addTitle: 'Орын қосу', addBody: 'KUNDE Maps-ке орын қосу әзірше қолжетімсіз: ол үшін аккаунттар мен модерация қажет. Карта деректері OpenStreetMap-тан алынады, орынды сол жерге қазір қосуға болады.',
      addOsm: 'OpenStreetMap ашу', ok: 'Түсінікті', cancel: 'Болдырмау',
      navTitle: 'Навигатор', navNoRoute: 'Бағыт әлі таңдалмады', navNoRouteHint: 'Алдымен бағыт құрыңыз, содан кейін «Бастау» түймесін басыңыз. GPS тек сіз басқаннан кейін қосылады.',
      navBuild: 'Бағыт құру', navReady: 'Бағыт дайын', navReadyHint: 'Бағытты тексеріп, GPS қосу үшін «Бастау» түймесін басыңыз.', navOpenRoute: 'Бағытты ашу',
      profile: 'Профиль', profileNote: 'KUNDE Maps-те аккаунттар әлі жоқ. Баптаулар тек осы құрылғыда сақталады.',
      setLanguage: 'Тіл', setTheme: 'Тақырып', themeSystem: 'Жүйелік', themeLight: 'Жарық', themeDark: 'Қараңғы',
      setUnits: 'Өлшем бірліктері', unitsMetric: 'Километр', unitsImperial: 'Миля',
      setEffects: 'Карта', setHistory: 'Іздеу тарихын сақтау', setHistoryNote: 'Тек осы браузердің жадында.',
      privacy: 'Құпиялылық', privacyBody: 'Таңдаулылар, тіл, тақырып және іздеу тарихы тек сіздің құрылғыңызда сақталады. Геолокация тек сіз басқанда қосылады; нүкте серверге тек жақын маңды іздеу (дөңгелектелген) және бағыт құру үшін жіберіледі, сақталмайды және журналға жазылмайды.',
      clearData: 'Құрылғыдағы деректерді жою', clearDataConfirm: 'Осы құрылғыдағы таңдаулыларды, іздеу тарихын және баптауларды жою керек пе?', clearDataDone: 'Құрылғыдағы деректер жойылды', delete: 'Жою',
      about: 'Қолданба туралы', aboutBody: 'KUNDE Maps — Қазақстанның тәуелсіз картасы. Карта, іздеу және бағыттар OpenStreetMap деректеріне негізделген.', aboutLicense: 'Деректер: © OpenStreetMap қатысушылары, ODbL лицензиясы.',
      aboutVersion: 'Интерфейс нұсқасы {v}', aboutOsm: 'OpenStreetMap авторлық құқығы туралы',
      distanceWord: 'Қашықтық', routeBlank: 'Қайда баратыныңызды көрсетіңіз. Бастапқы нүктені картадан таңдауға немесе GPS түймесімен алуға болады.', placeActions: 'Орынмен әрекеттер',
      historyOff: 'Іздеу тарихы өшірулі', themeChanged: 'Тақырып өзгертілді', dialogClose: 'Терезені жабу', moreCats: 'Басқа санаттар',
    },
    en: {
      tabsLabel: 'Sections', tabSearch: 'Search', tabRoute: 'Directions', tabNavigator: 'Navigator', tabFavorites: 'Saved', tabProfile: 'Profile',
      brandHome: 'KUNDE Maps', searchPlaceholder: 'Search places, addresses, routes', sheet: 'Panel', sheetCollapsed: 'Panel collapsed', sheetHalf: 'Panel half open',
      sheetFull: 'Panel fully open', sheetHandle: 'Panel size. Up and down arrows change the height',
      qaRoute: 'Route', qaDrive: 'Drive', qaFavorites: 'Saved', qaAdd: 'Add a place', nearYou: 'Near you', recent: 'Recent searches', clearHistory: 'Clear',
      qcShop: 'Groceries', qcFood: 'Food', qcHotel: 'Hotels', qcPharmacy: 'Pharmacies', qcFuel: 'Fuel', qcMore: 'More', allCategories: 'All categories', fewerCategories: 'Show less',
      catBank: 'Banks & ATMs',
      layers: 'Map layers', zoomIn: 'Zoom in', zoomOut: 'Zoom out', compass: 'Reset north', locate: 'My location',
      locIdle: 'Tap to show yourself on the map', locBusy: 'Locating…', locOk: 'Accuracy about {n} m', locDenied: 'Location access is blocked in the browser', locFail: 'Could not determine your location',
      layersTitle: 'Layers and performance', layer3d: '3D buildings', layer3dNote: 'Only where the data has building heights; otherwise buildings stay flat.',
      layerLow: 'Low-power mode', layerLowNote: 'No 3D and no animations. On by default for low-end devices.',
      layerTraffic: 'Traffic', layerTrafficNote: 'Not shown: KUNDE Maps has no verified source of live traffic data yet.',
      addTitle: 'Add a place', addBody: 'Adding places to KUNDE Maps is not available yet: it needs accounts and moderation. Map data comes from OpenStreetMap, where you can add a place today.',
      addOsm: 'Open OpenStreetMap', ok: 'Got it', cancel: 'Cancel',
      navTitle: 'Navigator', navNoRoute: 'No route selected yet', navNoRouteHint: 'Build a route, then press Start. GPS is switched on only after you press it.',
      navBuild: 'Build a route', navReady: 'Route is ready', navReadyHint: 'Review the route and press Start to switch GPS on.', navOpenRoute: 'Open route',
      profile: 'Profile', profileNote: 'KUNDE Maps has no accounts yet. Settings are stored on this device only.',
      setLanguage: 'Language', setTheme: 'Theme', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
      setUnits: 'Units', unitsMetric: 'Kilometres', unitsImperial: 'Miles',
      setEffects: 'Map', setHistory: 'Keep search history', setHistoryNote: 'In this browser only.',
      privacy: 'Privacy', privacyBody: 'Saved places, language, theme and search history stay on your device. Location is switched on only when you tap; the point is sent to our server only to search nearby (rounded) and to build a route, and is not stored or logged.',
      clearData: 'Delete data on this device', clearDataConfirm: 'Delete saved places, search history and settings on this device?', clearDataDone: 'Data on this device deleted', delete: 'Delete',
      about: 'About', aboutBody: 'KUNDE Maps is an independent map of Kazakhstan. The map, search and routes are built on OpenStreetMap data.', aboutLicense: 'Data: © OpenStreetMap contributors, ODbL licence.',
      aboutVersion: 'Interface version {v}', aboutOsm: 'About OpenStreetMap copyright',
      distanceWord: 'Distance', routeBlank: 'Say where you are going. Pick the start on the map or use the GPS button.', placeActions: 'Place actions',
      historyOff: 'Search history is off', themeChanged: 'Theme changed', dialogClose: 'Close dialog', moreCats: 'More categories',
    },
  };
  function shellT(lang, key, params) {
    let text = (S[lang] && S[lang][key]) ?? S.ru[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) text = text.replace('{' + k + '}', v);
    return text;
  }

  return {SNAPS, TABS, snapHeights, snapOnRelease, stepSnap, clampHeight, HISTORY_MAX, parseHistory, addHistory, DEFAULT_SETTINGS, parseSettings, buildingsEnabled,
    suggestLowPower, keyboardInset, shellT, S, VERSION: '5.5.0'};
});

/* KUNDE Maps web core: search client, i18n and formatting. No DOM access, unit-testable in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KundeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES_LIST = ['restaurant', 'cafe', 'pharmacy', 'hospital', 'shop', 'school', 'fuel', 'parking', 'bank', 'hotel',
    'beauty', 'sport', 'culture', 'park', 'auto', 'transport', 'services'];
  const MIN_CHARS = 2;
  const MAX_CHARS = 100;

  const STRINGS = {
    ru: {
      placeholder: 'Поиск места или адреса', searchLabel: 'Поиск на карте', clear: 'Очистить',
      searching: 'Ищем…', waking: 'Сервис поиска запускается, это может занять до минуты…',
      noResults: 'Ничего не найдено', noResultsHint: 'Проверьте написание или попробуйте другое название.',
      failed: 'Не удалось выполнить поиск', retry: 'Повторить', notConfigured: 'Поиск не настроен',
      rateLimited: 'Слишком много запросов. Попробуйте через {n} с', unavailable: 'Сервис поиска временно недоступен',
      results: 'Результаты', share: 'Поделиться', copyCoords: 'Копировать координаты', copied: 'Скопировано',
      linkCopied: 'Ссылка скопирована', copyFailed: 'Не удалось скопировать', close: 'Закрыть',
      selectedPoint: 'Выбранная точка', place: 'Место', locate: 'Моё местоположение',
      locating: 'Определяем местоположение…', located: 'Местоположение определено',
      geoUnsupported: 'Геолокация не поддерживается браузером', geoDenied: 'Разрешите доступ к геолокации в браузере',
      geoFailed: 'Не удалось определить местоположение', theme: 'Сменить тему', language: 'Язык подписей',
      sheetToggle: 'Развернуть или свернуть панель', resultsCount: 'Найдено: {n}', mapLoaded: 'Карта загружена',
      langChanged: 'Названия на русском', source: 'Данные: OpenStreetMap',
      chipsLabel: 'Категории мест', nearMe: 'Рядом', inThisArea: 'В этой области', zoomToSee: 'Приблизьте карту, чтобы увидеть места',
      placesFound: 'Мест: {n}', placesEmpty: 'Здесь нет мест выбранных категорий', placesEmptyHint: 'Отдалите карту или выберите другие категории', placesTruncated: 'Показаны лучшие результаты — приблизьте карту',
      placesFailed: 'Не удалось загрузить места', placesUnavailable: 'Места временно недоступны', nearbyEmpty: 'Рядом ничего не найдено',
      geoNearbyNote: 'Местоположение используется только для этого поиска и не сохраняется', clearFilters: 'Сбросить',
      openNow: 'Открыто', closedNow: 'Закрыто', open247: 'Круглосуточно', untilT: 'до {t}', opensAt: 'откроется в {t}', opensDay: 'откроется {d} в {t}',
      hours: 'Часы работы', hoursOsm: 'Часы работы (по данным OSM)', phone: 'Телефон', website: 'Сайт', address: 'Адрес', brand: 'Сеть',
      route: 'Маршрут', routeHint: 'Откроется OpenStreetMap с маршрутом до этого места', save: 'Сохранить', saved: 'Сохранено',
      routeTitle: 'Маршрут', routeFrom: 'Откуда', routeTo: 'Куда', myLocation: 'Моё местоположение', pickOnMap: 'Выбрать на карте', pickHint: 'Нажмите на карту, чтобы задать начало маршрута',
      modeCar: 'Авто', modeFoot: 'Пешком', modeBike: 'Велосипед', routeBuilding: 'Строим маршрут…', routeClose: 'Закрыть маршрут', routeSteps: 'Пошагово',
      routeNote: 'Время в пути рассчитано по данным OpenStreetMap без учёта пробок и перекрытий.', routeNarrationRu: 'Подсказки показаны на русском',
      routeNoRoute: 'Маршрут не найден', routeNoRoad: 'Рядом с точкой нет дороги подходящего типа', routeOutside: 'Маршруты доступны только по Казахстану',
      routeTooLong: 'Слишком длинный маршрут для этого вида транспорта', routeFailed: 'Не удалось построить маршрут', routeTooClose: 'Начало и конец совпадают',
      routeNeedStart: 'Укажите начало маршрута', routeExternal: 'Открыть в OpenStreetMap', routeSwap: 'Поменять местами', routeStart: 'Начало', routeEnd: 'Конец',
      routeAlt: 'Варианты маршрута', routeFastest: 'Быстрее всего', routeVariant: 'Вариант {n}', routeSearchPlaceholder: 'Адрес или место', routeUseMyLocation: 'Моё местоположение', routeSuggestions: 'Подсказки',
      hourShort: 'ч', minuteShort: 'мин',
      favorites: 'Сохранённые', favoritesEmpty: 'Пока ничего не сохранено. Нажмите «Сохранить» в карточке места.',
      favoritesNote: 'Хранится только на этом устройстве', remove: 'Удалить', savedToast: 'Добавлено в сохранённые', removedToast: 'Удалено из сохранённых',
      clusterOf: 'Группа мест: {n}', meters: 'м', kilometers: 'км', placeFromLink: 'Место по ссылке', backToList: 'Назад к списку',
    },
    kk: {
      placeholder: 'Орын немесе мекенжайды іздеу', searchLabel: 'Картадан іздеу', clear: 'Тазалау',
      searching: 'Іздеудеміз…', waking: 'Іздеу қызметі қосылып жатыр, бір минутқа дейін созылуы мүмкін…',
      noResults: 'Ештеңе табылмады', noResultsHint: 'Жазылуын тексеріңіз немесе басқа атауды көріңіз.',
      failed: 'Іздеуді орындау мүмкін болмады', retry: 'Қайталау', notConfigured: 'Іздеу бапталмаған',
      rateLimited: 'Тым көп сұраныс. {n} с кейін қайталаңыз', unavailable: 'Іздеу қызметі уақытша қолжетімсіз',
      results: 'Нәтижелер', share: 'Бөлісу', copyCoords: 'Координаттарды көшіру', copied: 'Көшірілді',
      linkCopied: 'Сілтеме көшірілді', copyFailed: 'Көшіру мүмкін болмады', close: 'Жабу',
      selectedPoint: 'Таңдалған нүкте', place: 'Орын', locate: 'Менің орным',
      locating: 'Орналасқан жер анықталуда…', located: 'Орналасқан жер анықталды',
      geoUnsupported: 'Браузер геолокацияны қолдамайды', geoDenied: 'Браузерде геолокацияға рұқсат беріңіз',
      geoFailed: 'Орналасқан жерді анықтау мүмкін болмады', theme: 'Тақырыпты ауыстыру', language: 'Жазулар тілі',
      sheetToggle: 'Панельді жаю немесе жию', resultsCount: 'Табылды: {n}', mapLoaded: 'Карта жүктелді',
      langChanged: 'Атаулар қазақша', source: 'Деректер: OpenStreetMap',
      chipsLabel: 'Орын санаттары', nearMe: 'Жақын', inThisArea: 'Осы аймақта', zoomToSee: 'Орындарды көру үшін картаны жақындатыңыз',
      placesFound: 'Орын: {n}', placesEmpty: 'Мұнда таңдалған санаттағы орындар жоқ', placesEmptyHint: 'Картаны алыстатыңыз немесе басқа санаттарды таңдаңыз', placesTruncated: 'Үздік нәтижелер көрсетілді — картаны жақындатыңыз',
      placesFailed: 'Орындарды жүктеу мүмкін болмады', placesUnavailable: 'Орындар уақытша қолжетімсіз', nearbyEmpty: 'Жақын жерде ештеңе табылмады',
      geoNearbyNote: 'Орналасқан жер тек осы іздеу үшін қолданылады және сақталмайды', clearFilters: 'Тазалау',
      openNow: 'Ашық', closedNow: 'Жабық', open247: 'Тәулік бойы', untilT: '{t} дейін', opensAt: '{t} ашылады', opensDay: '{d} {t} ашылады',
      hours: 'Жұмыс уақыты', hoursOsm: 'Жұмыс уақыты (OSM деректері)', phone: 'Телефон', website: 'Сайт', address: 'Мекенжай', brand: 'Желі',
      route: 'Маршрут', routeHint: 'Осы жерге маршрут бар OpenStreetMap ашылады', save: 'Сақтау', saved: 'Сақталды',
      routeTitle: 'Маршрут', routeFrom: 'Қайдан', routeTo: 'Қайда', myLocation: 'Менің орным', pickOnMap: 'Картадан таңдау', pickHint: 'Маршрут басталатын жерді картадан басыңыз',
      modeCar: 'Көлік', modeFoot: 'Жаяу', modeBike: 'Велосипед', routeBuilding: 'Маршрут құрылуда…', routeClose: 'Маршрутты жабу', routeSteps: 'Қадамдар',
      routeNote: 'Жол уақыты OpenStreetMap деректері бойынша есептелген, кептелістер мен жабылған жолдар ескерілмейді.', routeNarrationRu: 'Нұсқаулар орыс тілінде көрсетіледі',
      routeNoRoute: 'Маршрут табылмады', routeNoRoad: 'Нүктенің маңында қолайлы жол жоқ', routeOutside: 'Маршруттар тек Қазақстан бойынша қолжетімді',
      routeTooLong: 'Бұл көлік түріне маршрут тым ұзақ', routeFailed: 'Маршрутты құру мүмкін болмады', routeTooClose: 'Бастапқы және соңғы нүкте сәйкес келеді',
      routeNeedStart: 'Маршрут басын көрсетіңіз', routeExternal: 'OpenStreetMap-та ашу', routeSwap: 'Орындарын ауыстыру', routeStart: 'Басы', routeEnd: 'Соңы',
      routeAlt: 'Маршрут нұсқалары', routeFastest: 'Ең жылдам', routeVariant: '{n}-нұсқа', routeSearchPlaceholder: 'Мекенжай немесе орын', routeUseMyLocation: 'Менің орным', routeSuggestions: 'Ұсыныстар',
      hourShort: 'сағ', minuteShort: 'мин',
      favorites: 'Сақталғандар', favoritesEmpty: 'Әзірге ештеңе сақталмаған. Орын карточкасында «Сақтау» түймесін басыңыз.',
      favoritesNote: 'Тек осы құрылғыда сақталады', remove: 'Жою', savedToast: 'Сақталғандарға қосылды', removedToast: 'Сақталғандардан жойылды',
      clusterOf: 'Орындар тобы: {n}', meters: 'м', kilometers: 'км', placeFromLink: 'Сілтемедегі орын', backToList: 'Тізімге оралу',
    },
    en: {
      placeholder: 'Search places or addresses', searchLabel: 'Search the map', clear: 'Clear',
      searching: 'Searching…', waking: 'The search service is waking up, this can take up to a minute…',
      noResults: 'Nothing found', noResultsHint: 'Check the spelling or try another name.',
      failed: 'Search failed', retry: 'Retry', notConfigured: 'Search is not configured',
      rateLimited: 'Too many requests. Try again in {n}s', unavailable: 'The search service is temporarily unavailable',
      results: 'Results', share: 'Share', copyCoords: 'Copy coordinates', copied: 'Copied',
      linkCopied: 'Link copied', copyFailed: 'Could not copy', close: 'Close',
      selectedPoint: 'Selected point', place: 'Place', locate: 'My location',
      locating: 'Finding your location…', located: 'Location found',
      geoUnsupported: 'Geolocation is not supported by this browser', geoDenied: 'Allow location access in the browser',
      geoFailed: 'Could not determine your location', theme: 'Toggle theme', language: 'Label language',
      sheetToggle: 'Expand or collapse the panel', resultsCount: 'Found: {n}', mapLoaded: 'Map loaded',
      langChanged: 'English names', source: 'Data: OpenStreetMap',
      chipsLabel: 'Place categories', nearMe: 'Nearby', inThisArea: 'In this area', zoomToSee: 'Zoom in to see places',
      placesFound: 'Places: {n}', placesEmpty: 'No places of the selected categories here', placesEmptyHint: 'Zoom out or pick other categories', placesTruncated: 'Showing the best results — zoom in for more',
      placesFailed: 'Could not load places', placesUnavailable: 'Places are temporarily unavailable', nearbyEmpty: 'Nothing found nearby',
      geoNearbyNote: 'Your location is used only for this search and is not stored', clearFilters: 'Clear',
      openNow: 'Open', closedNow: 'Closed', open247: 'Open 24/7', untilT: 'until {t}', opensAt: 'opens at {t}', opensDay: 'opens {d} at {t}',
      hours: 'Opening hours', hoursOsm: 'Opening hours (from OSM)', phone: 'Phone', website: 'Website', address: 'Address', brand: 'Brand',
      route: 'Directions', routeHint: 'Opens OpenStreetMap with directions to this place', save: 'Save', saved: 'Saved',
      routeTitle: 'Route', routeFrom: 'From', routeTo: 'To', myLocation: 'My location', pickOnMap: 'Choose on map', pickHint: 'Tap the map to set the start of the route',
      modeCar: 'Drive', modeFoot: 'Walk', modeBike: 'Cycle', routeBuilding: 'Building the route…', routeClose: 'Close route', routeSteps: 'Step by step',
      routeNote: 'Travel time comes from OpenStreetMap speed data and ignores traffic and closures.', routeNarrationRu: 'Directions are shown in Russian',
      routeNoRoute: 'No route found', routeNoRoad: 'No suitable road near the point', routeOutside: 'Routes are available in Kazakhstan only',
      routeTooLong: 'This route is too long for the selected mode', routeFailed: 'Could not build the route', routeTooClose: 'Start and end are the same',
      routeNeedStart: 'Set the start of the route', routeExternal: 'Open in OpenStreetMap', routeSwap: 'Swap', routeStart: 'Start', routeEnd: 'End',
      routeAlt: 'Route options', routeFastest: 'Fastest', routeVariant: 'Option {n}', routeSearchPlaceholder: 'Address or place', routeUseMyLocation: 'My location', routeSuggestions: 'Suggestions',
      hourShort: 'h', minuteShort: 'min',
      favorites: 'Saved places', favoritesEmpty: 'Nothing saved yet. Tap “Save” on a place card.',
      favoritesNote: 'Stored on this device only', remove: 'Remove', savedToast: 'Added to saved places', removedToast: 'Removed from saved places',
      clusterOf: 'Group of {n} places', meters: 'm', kilometers: 'km', placeFromLink: 'Place from link', backToList: 'Back to list',
    },
  };

  const KINDS = {
    country: ['Страна', 'Ел', 'Country'], district: ['Район', 'Аудан', 'District'], quarter: ['Квартал', 'Квартал', 'Quarter'],
    city: ['Город', 'Қала', 'City'], town: ['Город', 'Қала', 'Town'], village: ['Село', 'Ауыл', 'Village'],
    hamlet: ['Населённый пункт', 'Елді мекен', 'Hamlet'], state: ['Область', 'Облыс', 'Region'],
    suburb: ['Район', 'Аудан', 'District'], neighbourhood: ['Микрорайон', 'Шағын аудан', 'Neighbourhood'],
    locality: ['Местность', 'Жер', 'Locality'], address: ['Адрес', 'Мекенжай', 'Address'],
    cafe: ['Кафе', 'Кафе', 'Cafe'], restaurant: ['Ресторан', 'Мейрамхана', 'Restaurant'],
    fast_food: ['Фастфуд', 'Фастфуд', 'Fast food'], pharmacy: ['Аптека', 'Дәріхана', 'Pharmacy'],
    fuel: ['АЗС', 'Жанармай бекеті', 'Fuel station'], bank: ['Банк', 'Банк', 'Bank'],
    school: ['Школа', 'Мектеп', 'School'], kindergarten: ['Детский сад', 'Балабақша', 'Kindergarten'],
    supermarket: ['Супермаркет', 'Супермаркет', 'Supermarket'], convenience: ['Магазин', 'Дүкен', 'Shop'],
    car_repair: ['Автосервис', 'Автосервис', 'Car repair'], hospital: ['Больница', 'Аурухана', 'Hospital'],
    university: ['Университет', 'Университет', 'University'], hotel: ['Гостиница', 'Қонақ үй', 'Hotel'],
    atm: ['Банкомат', 'Банкомат', 'ATM'], parking: ['Парковка', 'Тұрақ', 'Parking'],
    charging_station: ['Зарядная станция', 'Зарядтау станциясы', 'Charging station'], clinic: ['Клиника', 'Клиника', 'Clinic'],
    doctors: ['Врачи', 'Дәрігерлер', 'Doctors'], dentist: ['Стоматология', 'Тіс емханасы', 'Dentist'],
    veterinary: ['Ветеринар', 'Мал дәрігері', 'Veterinary'], bakery: ['Пекарня', 'Наубайхана', 'Bakery'],
    ice_cream: ['Мороженое', 'Балмұздақ', 'Ice cream'], pub: ['Паб', 'Паб', 'Pub'], bar: ['Бар', 'Бар', 'Bar'],
    nightclub: ['Ночной клуб', 'Түнгі клуб', 'Nightclub'], hostel: ['Хостел', 'Хостел', 'Hostel'],
    guest_house: ['Гостевой дом', 'Қонақ үй', 'Guest house'], motel: ['Мотель', 'Мотель', 'Motel'],
    apartment: ['Апартаменты', 'Апартамент', 'Apartments'], fitness_centre: ['Фитнес-центр', 'Фитнес орталығы', 'Fitness centre'],
    sports_centre: ['Спортцентр', 'Спорт орталығы', 'Sports centre'], stadium: ['Стадион', 'Стадион', 'Stadium'],
    swimming_pool: ['Бассейн', 'Бассейн', 'Swimming pool'], cinema: ['Кинотеатр', 'Кинотеатр', 'Cinema'],
    theatre: ['Театр', 'Театр', 'Theatre'], museum: ['Музей', 'Музей', 'Museum'], gallery: ['Галерея', 'Галерея', 'Gallery'],
    library: ['Библиотека', 'Кітапхана', 'Library'], park: ['Парк', 'Саябақ', 'Park'],
    playground: ['Детская площадка', 'Балалар алаңы', 'Playground'], garden: ['Сад', 'Бақ', 'Garden'],
    post_office: ['Почта', 'Пошта', 'Post office'], police: ['Полиция', 'Полиция', 'Police'],
    townhall: ['Акимат', 'Әкімдік', 'Town hall'], taxi: ['Такси', 'Такси', 'Taxi'],
    bus_station: ['Автовокзал', 'Автовокзал', 'Bus station'], station: ['Вокзал', 'Вокзал', 'Station'],
    car_wash: ['Автомойка', 'Автожуу', 'Car wash'], hairdresser: ['Парикмахерская', 'Шаштараз', 'Hairdresser'],
    beauty: ['Салон красоты', 'Сұлулық салоны', 'Beauty salon'], massage: ['Массаж', 'Массаж', 'Massage'],
    mall: ['Торговый центр', 'Сауда орталығы', 'Mall'], clothes: ['Одежда', 'Киім', 'Clothes'], college: ['Колледж', 'Колледж', 'College'],
  };
  const LANG_INDEX = {ru: 0, kk: 1, en: 2};

  // Zoom to use after selecting a result, by object scale.
  const ZOOM_BY_KIND = {state: 8, city: 11, town: 12, village: 13, hamlet: 14, suburb: 13, neighbourhood: 14, locality: 14};

  const LANGS = ['ru', 'kk', 'en'];

  function t(lang, key, params) {
    const table = STRINGS[lang] || STRINGS.ru;
    let text = table[key] ?? STRINGS.ru[key] ?? key;
    for (const [name, value] of Object.entries(params || {})) text = text.replace('{' + name + '}', String(value));
    return text;
  }

  function normalizeQuery(value) {
    return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  }

  function isSearchable(value) {
    const q = normalizeQuery(value);
    return q.length >= MIN_CHARS && q.length <= MAX_CHARS;
  }

  function kindLabel(kind, lang) {
    const entry = KINDS[kind];
    return entry ? entry[LANG_INDEX[lang] ?? 0] : t(lang, 'place');
  }

  function zoomForKind(kind) {
    return ZOOM_BY_KIND[kind] ?? 16;
  }

  /** Name in the UI language, falling back to the canonical OSM name. Never invents names. */
  function displayName(place, lang) {
    const localized = lang === 'kk' ? place.nameKk : lang === 'ru' ? place.nameRu : lang === 'en' ? place.nameEn : '';
    return localized || place.name || place.nameRu || place.nameKk || place.nameEn || '';
  }

  function formatCoords(lat, lon) {
    return lat.toFixed(5) + ', ' + lon.toFixed(5);
  }

  function parseConfigUrl(value, allowLocal) {
    if (!value) return null;
    let url;
    try { url = new URL(value); } catch (_) { return null; }
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(allowLocal && local)) return null;
    return url.origin + url.pathname.replace(/\/+$/, '');
  }

  function validPlace(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const lat = Number(raw.lat), lon = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const name = typeof raw.name === 'string' ? raw.name : '';
    if (!name && !raw.name_ru && !raw.name_kk) return null;
    return {
      id: raw.id, name, nameRu: String(raw.name_ru || ''), nameKk: String(raw.name_kk || ''), nameEn: String(raw.name_en || ''),
      kind: String(raw.kind || ''), lat, lon,
      // present when the index has place attributes: the stable OSM id and category open the full place card
      placeId: typeof raw.place_id === 'string' && /^[nwr]\d{1,12}$/.test(raw.place_id) ? raw.place_id : null,
      category: CATEGORIES_LIST.includes(raw.category) ? raw.category : null,
      // address rows: nearest settlement name derived by the API (context only, may be absent)
      locality: typeof raw.locality === 'string' ? raw.locality.slice(0, 80) : '',
    };
  }

  class SearchError extends Error {
    constructor(code, extra) {
      super(code);
      this.name = 'SearchError';
      this.code = code;
      Object.assign(this, extra || {});
    }
  }

  const sleepDefault = ms => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * GET-only JSON transport shared by the search and places clients: abort + timeout, one retry on
   * network/5xx/timeout (safe for GET), 4xx never retried, 429 surfaced with a capped Retry-After.
   */
  function createFetcher(options) {
    const {
      fetchImpl = (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      timeoutMs = 20000, wakeAfterMs = 3500, retries = 1, retryDelayMs = 700, sleep = sleepDefault,
    } = options;

    async function attemptOnce(url, outerSignal, onSlow) {
      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort();
      if (outerSignal) {
        if (outerSignal.aborted) throw new SearchError('aborted');
        outerSignal.addEventListener('abort', onAbort, {once: true});
      }
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      const slowTimer = onSlow ? setTimeout(onSlow, wakeAfterMs) : null;
      try {
        const response = await fetchImpl(url, {signal: controller.signal, headers: {Accept: 'application/json'}, credentials: 'omit'});
        if (response.status === 429) {
          const retryAfter = Number.parseInt(response.headers?.get?.('Retry-After') ?? '', 10);
          throw new SearchError('rate_limited', {retryAfter: Number.isFinite(retryAfter) ? Math.min(retryAfter, 120) : 10});
        }
        if (response.status === 400 || response.status === 404) {
          let detail = '';
          try { detail = String((await response.json()).error || '').slice(0, 60); } catch (_) { /* body is optional */ }
          throw new SearchError(response.status === 400 ? 'bad_request' : 'not_found', {detail});
        }
        if (!response.ok) throw new SearchError('unavailable', {status: response.status, transient: response.status >= 500});
        return await response.json();
      } catch (error) {
        if (error instanceof SearchError) throw error;
        if (outerSignal?.aborted) throw new SearchError('aborted');
        if (timedOut) throw new SearchError('timeout', {transient: true});
        if (error?.name === 'AbortError') throw new SearchError('aborted');
        throw new SearchError('network', {transient: true});
      } finally {
        clearTimeout(timer);
        if (slowTimer) clearTimeout(slowTimer);
        outerSignal?.removeEventListener('abort', onAbort);
      }
    }

    return async function getJson(url, {signal, onSlow} = {}) {
      let lastError;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await attemptOnce(url, signal, onSlow);
        } catch (error) {
          lastError = error;
          if (!error.transient || attempt === retries) break;
          await sleep(retryDelayMs);
          if (signal?.aborted) throw new SearchError('aborted');
        }
      }
      throw lastError;
    };
  }

  function createSearchClient(options) {
    const {baseUrl, cacheSize = 40, cacheTtlMs = 5 * 60 * 1000, now = () => Date.now()} = options;
    const getJson = createFetcher(options);
    const cache = new Map();

    async function search(query, {limit = 10, signal, onSlow, lang, center} = {}) {
      const q = normalizeQuery(query);
      if (!isSearchable(q)) throw new SearchError('bad_request');
      if (!baseUrl) throw new SearchError('not_configured');
      // Optional ranking hints: UI language and the map viewport centre (rounded to ~1 km; not the user's location).
      let extra = '';
      if (LANGS.includes(lang)) extra += '&lang=' + lang;
      if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
        extra += '&lat=' + center.lat.toFixed(2) + '&lon=' + center.lng.toFixed(2);
      }
      const key = q.toLocaleLowerCase('ru') + '|' + limit + extra;
      const hit = cache.get(key);
      if (hit && now() - hit.at < cacheTtlMs) return hit.results;
      const url = baseUrl + '/v1/search?q=' + encodeURIComponent(q) + '&limit=' + limit + extra;
      const body = await getJson(url, {signal, onSlow});
      if (!body || !Array.isArray(body.results)) throw new SearchError('invalid_response');
      const results = body.results.map(validPlace).filter(Boolean);
      cache.set(key, {at: now(), results});
      if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
      return results;
    }

    return {search, clearCache: () => cache.clear()};
  }

  /** Shareable place link parameters: #lat=..&lng=..&name=..[&poi=n123]. Returns null for anything invalid. */
  const ROUTE_MODES = ['car', 'foot', 'bike'];

  function parsePlaceHash(hash) {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    const lat = Number(params.get('lat')), lng = Number(params.get('lng'));
    if (!params.has('lat') || !params.has('lng') || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const poi = params.get('poi') || '';
    const route = params.get('route');
    return {lat, lng, name: (params.get('name') || '').slice(0, MAX_CHARS), poi: /^[nwr]\d{1,12}$/.test(poi) ? poi : null,
      route: ROUTE_MODES.includes(route) ? route : null};  // destination-only deep link: the start is never part of a URL
  }

  function buildPlaceHash(lat, lng, name, poi, routeMode) {
    const params = new URLSearchParams({lat: lat.toFixed(5), lng: lng.toFixed(5)});
    if (name) params.set('name', String(name).slice(0, MAX_CHARS));
    if (poi && /^[nwr]\d{1,12}$/.test(poi)) params.set('poi', poi);
    if (ROUTE_MODES.includes(routeMode)) params.set('route', routeMode);
    return '#' + params.toString();
  }

  // ---- Places & POI -------------------------------------------------------------------------------------
  const CATEGORIES = CATEGORIES_LIST;
  const CATEGORY_LABELS = {
    restaurant: ['Рестораны', 'Мейрамханалар', 'Restaurants'], cafe: ['Кафе', 'Кафе', 'Cafes'],
    pharmacy: ['Аптеки', 'Дәріханалар', 'Pharmacies'], hospital: ['Больницы', 'Ауруханалар', 'Hospitals'],
    shop: ['Магазины', 'Дүкендер', 'Shops'], school: ['Школы и вузы', 'Мектептер мен ЖОО', 'Schools'],
    fuel: ['АЗС', 'Жанармай бекеттері', 'Fuel'], parking: ['Парковки', 'Тұрақтар', 'Parking'],
    bank: ['Банки', 'Банктер', 'Banks'], hotel: ['Гостиницы', 'Қонақ үйлер', 'Hotels'],
    beauty: ['Красота', 'Сұлулық', 'Beauty'], sport: ['Спорт', 'Спорт', 'Sports'],
    culture: ['Культура', 'Мәдениет', 'Culture'], park: ['Парки', 'Саябақтар', 'Parks'],
    auto: ['Авто', 'Авто', 'Auto'], transport: ['Транспорт', 'Көлік', 'Transport'], services: ['Услуги', 'Қызметтер', 'Services'],
  };
  // One hue per category (also used by the chips); drawn with a white/dark outline on the map.
  const CATEGORY_COLORS = {
    restaurant: '#e0652b', cafe: '#b7791f', pharmacy: '#d93f55', hospital: '#c2255c', shop: '#3f6fe0', school: '#7a5bc7',
    fuel: '#c99a06', parking: '#5b6b82', bank: '#2f9b86', hotel: '#a24f9a', beauty: '#e0559f', sport: '#2f9e44',
    culture: '#0f7ba8', park: '#4c9a2a', auto: '#8a5a44', transport: '#1f88b8', services: '#7c8aa5',
  };
  const PLACE_ID = /^[nwr]\d{1,12}$/;

  function categoryLabel(id, lang) {
    const entry = CATEGORY_LABELS[id];
    return entry ? entry[LANG_INDEX[lang] ?? 0] : t(lang, 'place');
  }

  /** Kind of a place for display: the specific OSM value when we have a label for it, else the category. */
  function placeKindLabel(place, lang) {
    return KINDS[place.subtype] ? KINDS[place.subtype][LANG_INDEX[lang] ?? 0] : categoryLabel(place.category, lang);
  }

  /** Only absolute http(s) URLs without credentials. Defence in depth: the index builder already filters. */
  function safeWebsite(value) {
    if (typeof value !== 'string' || value.length > 300) return null;
    let url;
    try { url = new URL(value); } catch (_) { return null; }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  }

  /** href for tel: links, or null when the text is not a plausible number. */
  function telHref(value) {
    if (typeof value !== 'string') return null;
    const first = value.split(/[;,]/)[0].trim();
    if (!/^[+0-9 ()\-.]{5,25}$/.test(first)) return null;
    const digits = first.replace(/[^0-9]/g, '');
    return digits.length >= 5 ? 'tel:' + (first.startsWith('+') ? '+' : '') + digits : null;
  }

  function validPoi(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const lat = Number(raw.lat), lon = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (!CATEGORIES.includes(raw.category)) return null;
    const text = (value, max) => (typeof value === 'string' && value.trim() ? value.slice(0, max) : null);
    return {
      id: typeof raw.id === 'string' && PLACE_ID.test(raw.id) ? raw.id : null,
      name: text(raw.name, 200), nameRu: text(raw.name_ru, 200), nameKk: text(raw.name_kk, 200), nameEn: text(raw.name_en, 200),
      category: raw.category, subtype: typeof raw.subtype === 'string' ? raw.subtype.slice(0, 40) : '',
      lat, lon, address: text(raw.address, 300), phone: text(raw.phone, 120), website: safeWebsite(raw.website),
      hours: text(raw.hours, 250), brand: text(raw.brand, 80),
      distance: Number.isFinite(raw.distance_m) ? raw.distance_m : null,
    };
  }

  /** Name in the UI language; unnamed objects (ATMs, parking lots) are shown by their kind, never with a made-up name. */
  function poiTitle(place, lang) {
    const localized = lang === 'kk' ? place.nameKk : lang === 'ru' ? place.nameRu : lang === 'en' ? place.nameEn : null;
    return localized || place.name || place.nameRu || place.nameKk || place.nameEn || placeKindLabel(place, lang);
  }

  function formatDistance(meters, lang) {
    if (!Number.isFinite(meters)) return '';
    return meters < 1000 ? Math.round(meters / 10) * 10 + ' ' + t(lang, 'meters') : (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + ' ' + t(lang, 'kilometers');
  }

  /** Link to external directions (OpenStreetMap). Used until KUNDE routing exists; no coordinates are sent by us. */
  function routeUrl(lat, lon) {
    return 'https://www.openstreetmap.org/directions?from=&to=' + encodeURIComponent(lat.toFixed(5) + ',' + lon.toFixed(5));
  }

  /** "1 h 05 min" / "12 min" / "<1 min" in the UI language. */
  function formatDuration(seconds, lang) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const total = Math.round(seconds / 60);
    if (total < 1) return '<1 ' + t(lang, 'minuteShort');
    const hours = Math.floor(total / 60), minutes = total % 60;
    return hours ? hours + ' ' + t(lang, 'hourShort') + (minutes ? ' ' + minutes + ' ' + t(lang, 'minuteShort') : '') : minutes + ' ' + t(lang, 'minuteShort');
  }

  const MAX_ROUTE_POINTS = 100000, MAX_ROUTE_STEPS = 600;
  const inRange = (lon, lat) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;

  /** Validates a /v1/route reply; returns null for anything malformed. All text fields stay plain strings (rendered with textContent). */
  function validRoute(body) {
    if (!body || typeof body !== 'object' || !ROUTE_MODES.includes(body.mode)) return null;
    const distance = Number(body.distance_m), duration = Number(body.duration_s);
    const coords = body.geometry && body.geometry.type === 'LineString' ? body.geometry.coordinates : null;
    if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(duration) || duration < 0) return null;
    if (!Array.isArray(coords) || coords.length < 2 || coords.length > MAX_ROUTE_POINTS) return null;
    for (const c of coords) if (!Array.isArray(c) || !inRange(Number(c[0]), Number(c[1]))) return null;
    const steps = [];
    for (const step of (Array.isArray(body.steps) ? body.steps.slice(0, MAX_ROUTE_STEPS) : [])) {
      if (!step || typeof step.instruction !== 'string' || !Array.isArray(step.location) || !inRange(Number(step.location[0]), Number(step.location[1]))) continue;
      steps.push({instruction: step.instruction.slice(0, 300), street: typeof step.street === 'string' ? step.street.slice(0, 120) : '',
        distance: Math.max(0, Number(step.distance_m) || 0), duration: Math.max(0, Number(step.duration_s) || 0), type: Number(step.type) || 0,
        lon: Number(step.location[0]), lat: Number(step.location[1])});
    }
    const bbox = Array.isArray(body.bbox) && body.bbox.length === 4 && body.bbox.every(Number.isFinite) ? body.bbox : null;
    const alternatives = (Array.isArray(body.alternatives) && !body.isAlternative ? body.alternatives.slice(0, 3) : [])
      .map(alt => validRoute({...alt, mode: body.mode, isAlternative: true, instruction_language: body.instruction_language})).filter(Boolean);
    return {mode: body.mode, distance, duration, coordinates: coords.map(c => [Number(c[0]), Number(c[1])]), steps, bbox, alternatives,
      dataVersion: typeof body.data_version === 'string' ? body.data_version.slice(0, 60) : '',
      narrationLang: ['ru', 'kk', 'en'].includes(body.instruction_language) ? body.instruction_language : 'ru'};
  }

  /** Routing client (GET /v1/route). No caching: requests are position specific. Errors carry `detail` = the API error code. */
  function createRouteClient(options) {
    const {baseUrl} = options;
    const getJson = createFetcher({retries: 0, ...options});
    const point = p => p.lat.toFixed(5) + ',' + p.lon.toFixed(5);
    return {
      async route({from, to, mode = 'car', lang = 'ru', alternatives = false, signal, onSlow}) {
        if (!baseUrl) throw new SearchError('not_configured');
        if (!ROUTE_MODES.includes(mode) || !from || !to || ![from.lat, from.lon, to.lat, to.lon].every(Number.isFinite)) throw new SearchError('bad_request');
        const body = await getJson(baseUrl + '/v1/route?from=' + point(from) + '&to=' + point(to) + '&mode=' + mode + '&lang=' + lang + (alternatives ? '&alternatives=1' : ''), {signal, onSlow});
        const route = validRoute(body);
        if (!route) throw new SearchError('invalid_response');
        return route;
      },
    };
  }

  function createPlacesClient(options) {
    const {baseUrl, cacheSize = 30, cacheTtlMs = 2 * 60 * 1000, now = () => Date.now()} = options;
    const getJson = createFetcher(options);
    const cache = new Map();
    const need = () => { if (!baseUrl) throw new SearchError('not_configured'); };
    const cats = list => (Array.isArray(list) ? list.filter(c => CATEGORIES.includes(c)) : []);

    async function cached(url, signal, onSlow, pick) {
      const hit = cache.get(url);
      if (hit && now() - hit.at < cacheTtlMs) return hit.value;
      const body = await getJson(baseUrl + url, {signal, onSlow});
      const value = pick(body);
      cache.set(url, {at: now(), value});
      if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
      return value;
    }
    const listPick = body => {
      if (!body || !Array.isArray(body.places)) throw new SearchError('invalid_response');
      return {places: body.places.map(validPoi).filter(Boolean), truncated: Boolean(body.truncated)};
    };

    return {
      /** Places inside the viewport. bbox = {west, south, east, north}; center optional ranking hint. */
      async viewport({bbox, categories: wanted, center, limit = 150, signal, onSlow}) {
        need();
        const f = n => n.toFixed(4);
        let url = '/v1/places?bbox=' + [bbox.west, bbox.south, bbox.east, bbox.north].map(f).join(',') + '&limit=' + limit;
        if (cats(wanted).length) url += '&category=' + cats(wanted).join(',');
        if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) url += '&lat=' + center.lat.toFixed(3) + '&lon=' + center.lng.toFixed(3);
        return cached(url, signal, onSlow, listPick);
      },
      /** Nearby places. The position is rounded to ~100 m before it leaves the device and is never cached beyond the session. */
      async nearby({lat, lon, radius = 1500, categories: wanted, limit = 60, signal, onSlow}) {
        need();
        let url = '/v1/places?lat=' + lat.toFixed(3) + '&lon=' + lon.toFixed(3) + '&radius=' + Math.round(radius) + '&limit=' + limit;
        if (cats(wanted).length) url += '&category=' + cats(wanted).join(',');
        return cached(url, signal, onSlow, listPick);
      },
      async details(id, {signal} = {}) {
        need();
        if (!PLACE_ID.test(id || '')) throw new SearchError('bad_request');
        const place = await cached('/v1/places/' + id, signal, null, body => {
          const parsed = validPoi(body && body.place);
          if (!parsed) throw new SearchError('invalid_response');
          return parsed;
        });
        return place;
      },
      clearCache: () => cache.clear(),
    };
  }

  // ---- opening_hours (OSM) --------------------------------------------------------------------------------
  const DAY_CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const WEEKDAY_LABELS = {
    ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'], kk: ['Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сн', 'Жс'],
    en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  };
  const HOURS_TZ = 'Asia/Almaty'; // Kazakhstan is on UTC+5

  const toMinutes = (h, m) => Number(h) * 60 + Number(m);
  const pad = n => String(n).padStart(2, '0');
  const clock = minutes => pad(Math.floor((minutes % 1440) / 60)) + ':' + pad(minutes % 60);

  /**
   * Parses the common subset of the OSM opening_hours grammar: "24/7", "Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off",
   * several ranges per day, overnight ranges. Anything else (holidays, months, sunrise, week numbers, "+") returns null,
   * which callers must present as "unknown" and show the raw OSM string. Never guesses.
   * Result: {days: [[start, end]...] x 7} with minutes since midnight; end > 1440 means "continues after midnight".
   */
  function parseOpeningHours(text) {
    if (typeof text !== 'string') return null;
    const source = text.trim();
    if (!source) return null;
    if (source === '24/7') return {days: Array.from({length: 7}, () => [[0, 1440]])};
    const days = Array.from({length: 7}, () => []);
    const dayToken = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
    const span = '\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}';
    const rule = new RegExp('^(?:(' + dayToken + '(?:-' + dayToken + ')?(?:\\s*,\\s*' + dayToken + '(?:-' + dayToken + ')?)*)\\s+)?(off|closed|' + span + '(?:\\s*,\\s*' + span + ')*)$', 'i');
    // Tolerated, unambiguous variants seen in real OSM data:
    //  - "Mo-Fr 09:00-18:00, Sa 10:00-14:00": a comma between a time and a weekday starts a new rule;
    //  - "Mo-Su,PH 09:00-18:00": public holidays with the same hours add nothing to the weekday schedule.
    // "PH off", holiday-only rules, months, sunrise etc. remain unsupported (-> unknown).
    const normalized = source.replace(/(\d{1,2}:\d{2})\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/g, '$1; ').replace(/,\s*PH(?=\s+\d)/g, '').replace(/\bPH\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/g, '');
    for (const part of normalized.split(';').map(x => x.trim()).filter(Boolean)) {
      const match = rule.exec(part);
      if (!match) return null;
      const selected = new Set();
      if (!match[1]) DAY_CODES.forEach((_, i) => selected.add(i));
      else {
        for (const piece of match[1].split(/\s*,\s*/)) {
          const [from, to] = piece.split('-').map(x => DAY_CODES.findIndex(d => d.toLowerCase() === x.toLowerCase()));
          if (to === undefined) selected.add(from);
          else for (let i = from; ; i = (i + 1) % 7) { selected.add(i); if (i === to) break; }
        }
      }
      let ranges = [];
      if (!/^(off|closed)$/i.test(match[2])) {
        for (const r of match[2].split(',')) {
          const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(r);
          const sh = Number(m[1]), sm = Number(m[2]), eh = Number(m[3]), em = Number(m[4]);
          if (sm > 59 || em > 59 || sh > 23 || eh > 24 || (eh === 24 && em !== 0)) return null;
          const start = sh * 60 + sm;
          let end = eh * 60 + em;
          if (end <= start) end += 1440; // overnight range such as 22:00-02:00
          ranges.push([start, end]);
        }
      }
      selected.forEach(i => { days[i] = ranges.map(r => r.slice()); }); // later rules override earlier ones for the same days
    }
    return {days};
  }

  function almatyParts(date) {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone: HOURS_TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
      .formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return {day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday), minutes: toMinutes(parts.hour, parts.minute)};
  }

  /**
   * Is the place open at `date` (default now)? Returns null when the string cannot be interpreted safely.
   * {state: 'open'|'closed', allDay, until: 'HH:MM', next: {offset: days ahead, time: 'HH:MM'}}
   */
  function openStatus(text, date = new Date()) {
    const parsed = parseOpeningHours(text);
    if (!parsed) return null;
    if (text.trim() === '24/7') return {state: 'open', allDay: true};
    const {day, minutes} = almatyParts(date);
    for (const [start, end] of parsed.days[day]) {
      if (minutes >= start && minutes < end) return {state: 'open', allDay: false, until: clock(end)};
    }
    for (const [, end] of parsed.days[(day + 6) % 7]) {
      if (end > 1440 && minutes < end - 1440) return {state: 'open', allDay: false, until: clock(end - 1440)};
    }
    for (let offset = 0; offset < 8; offset++) {
      const index = (day + offset) % 7;
      const starts = parsed.days[index].map(r => r[0]).filter(start => offset > 0 || start > minutes).sort((a, b) => a - b);
      if (starts.length) return {state: 'closed', allDay: false, next: {offset, time: clock(starts[0]), day: index}};
    }
    return {state: 'closed', allDay: false, next: null};
  }

  /** Seven display rows [{day: 'Пн', text: '09:00–21:00' | null}] for a parsed schedule (null text = closed). */
  function hoursTable(text, lang) {
    const parsed = parseOpeningHours(text);
    if (!parsed) return null;
    return parsed.days.map((ranges, i) => ({
      day: (WEEKDAY_LABELS[lang] || WEEKDAY_LABELS.ru)[i],
      text: ranges.length ? ranges.map(([a, b]) => clock(a) + '–' + (b === 1440 ? '24:00' : clock(b))).join(', ') : null,
    }));
  }

  /** One-line label such as "Открыто · до 21:00". Returns {state, label} or null for unknown/unparseable hours. */
  function openLabel(text, lang, date = new Date()) {
    const status = openStatus(text, date);
    if (!status) return null;
    if (status.state === 'open') {
      return {state: 'open', label: status.allDay ? t(lang, 'open247') : t(lang, 'openNow') + ' · ' + t(lang, 'untilT', {t: status.until})};
    }
    if (!status.next) return {state: 'closed', label: t(lang, 'closedNow')};
    const when = status.next.offset === 0 ? t(lang, 'opensAt', {t: status.next.time})
      : t(lang, 'opensDay', {d: (WEEKDAY_LABELS[lang] || WEEKDAY_LABELS.ru)[status.next.day], t: status.next.time});
    return {state: 'closed', label: t(lang, 'closedNow') + ' · ' + when};
  }

  // ---- favorites (device-local; pure helpers, storage lives in the UI layer) ----------------------------------
  const FAVORITES_MAX = 200;
  function favoriteKey(place) { return place.id || place.lat.toFixed(5) + ',' + place.lon.toFixed(5); }
  function isFavorite(list, place) { return list.some(item => favoriteKey(item) === favoriteKey(place)); }
  /** Returns {list, saved}: adds the place (newest first, capped) or removes it. Only stored fields are copied. */
  function toggleFavorite(list, place) {
    const key = favoriteKey(place);
    if (list.some(item => favoriteKey(item) === key)) return {list: list.filter(item => favoriteKey(item) !== key), saved: false};
    const snapshot = {id: place.id, name: place.name, nameRu: place.nameRu, nameKk: place.nameKk, nameEn: place.nameEn,
      category: place.category, subtype: place.subtype, lat: place.lat, lon: place.lon, address: place.address};
    return {list: [snapshot, ...list].slice(0, FAVORITES_MAX), saved: true};
  }
  /** Validate one persisted favorite (category may be null for plain points and search hits). */
  function validFavorite(item) {
    if (!item || typeof item !== 'object') return null;
    const lat = Number(item.lat), lon = Number(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (item.category != null && item.category !== '' && !CATEGORIES_LIST.includes(item.category)) return null;
    const text = (value, max) => (typeof value === 'string' && value.trim() ? value.slice(0, max) : null);
    return {
      id: typeof item.id === 'string' && PLACE_ID.test(item.id) ? item.id : null,
      name: text(item.name, 200), nameRu: text(item.nameRu, 200), nameKk: text(item.nameKk, 200), nameEn: text(item.nameEn, 200),
      category: item.category || null, subtype: typeof item.subtype === 'string' ? item.subtype.slice(0, 40) : '',
      lat, lon, address: text(item.address, 300),
    };
  }
  /** Parse and validate persisted favorites; anything malformed is dropped. */
  function parseFavorites(json) {
    let raw;
    try { raw = JSON.parse(json || '[]'); } catch (_) { return []; }
    return Array.isArray(raw) ? raw.slice(0, FAVORITES_MAX).map(validFavorite).filter(Boolean) : [];
  }
  /** Title of a favorite in the UI language; never invented (falls back to kind, then coordinates). */
  function favoriteTitle(item, lang) {
    const localized = lang === 'kk' ? item.nameKk : lang === 'ru' ? item.nameRu : lang === 'en' ? item.nameEn : null;
    return localized || item.name || item.nameRu || item.nameKk || item.nameEn
      || (item.category ? placeKindLabel(item, lang) : formatCoords(item.lat, item.lon));
  }

  return {
    MIN_CHARS, MAX_CHARS, LANGS, STRINGS, t, normalizeQuery, isSearchable, kindLabel, zoomForKind, displayName,
    formatCoords, parseConfigUrl, validPlace, SearchError, createSearchClient, parsePlaceHash, buildPlaceHash,
    CATEGORIES, CATEGORY_COLORS, CATEGORY_LABELS, PLACE_ID, categoryLabel, placeKindLabel, safeWebsite, telHref, validPoi, poiTitle,
    formatDistance, formatDuration, routeUrl, validRoute, createRouteClient, ROUTE_MODES, createPlacesClient, parseOpeningHours, openStatus, hoursTable, openLabel, WEEKDAY_LABELS,
    favoriteKey, isFavorite, toggleFavorite, parseFavorites, validFavorite, favoriteTitle,
  };
});

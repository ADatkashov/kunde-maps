/* KUNDE Maps web core: search client, i18n and formatting. No DOM access, unit-testable in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KundeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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
    },
  };

  const KINDS = {
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
   * Search API client. GET-only, so one retry on network/5xx/timeout is safe.
   * 4xx other than 429 is never retried; 429 is surfaced with Retry-After.
   */
  function createSearchClient(options) {
    const {
      baseUrl, fetchImpl = (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      timeoutMs = 20000, wakeAfterMs = 3500, retries = 1, retryDelayMs = 700, cacheSize = 40, cacheTtlMs = 5 * 60 * 1000,
      sleep = sleepDefault, now = () => Date.now(),
    } = options;
    const cache = new Map();

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
        if (response.status === 400) throw new SearchError('bad_request');
        if (!response.ok) throw new SearchError('unavailable', {status: response.status, transient: response.status >= 500});
        const body = await response.json();
        if (!body || !Array.isArray(body.results)) throw new SearchError('invalid_response');
        return body.results.map(validPlace).filter(Boolean);
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
      let lastError;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const results = await attemptOnce(url, signal, onSlow);
          cache.set(key, {at: now(), results});
          if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
          return results;
        } catch (error) {
          lastError = error;
          if (!error.transient || attempt === retries) break;
          await sleep(retryDelayMs);
          if (signal?.aborted) throw new SearchError('aborted');
        }
      }
      throw lastError;
    }

    return {search, clearCache: () => cache.clear()};
  }

  /** Shareable place link parameters: #lat=..&lng=..&name=.. . Returns null for anything invalid. */
  function parsePlaceHash(hash) {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    const lat = Number(params.get('lat')), lng = Number(params.get('lng'));
    if (!params.has('lat') || !params.has('lng') || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return {lat, lng, name: (params.get('name') || '').slice(0, MAX_CHARS)};
  }

  function buildPlaceHash(lat, lng, name) {
    const params = new URLSearchParams({lat: lat.toFixed(5), lng: lng.toFixed(5)});
    if (name) params.set('name', String(name).slice(0, MAX_CHARS));
    return '#' + params.toString();
  }

  return {
    MIN_CHARS, MAX_CHARS, LANGS, STRINGS, t, normalizeQuery, isSearchable, kindLabel, zoomForKind, displayName,
    formatCoords, parseConfigUrl, validPlace, SearchError, createSearchClient, parsePlaceHash, buildPlaceHash,
  };
});

/* KUNDE Maps navigation core (Phase 5). No DOM, no map library: unit-testable in Node.
 *
 * Pieces: geo math, RouteIndex + matcher (projection on route segments with a monotonic progress window), GPS fix filter,
 * explicit state machine, maneuver tracking with structured RU/KK/EN texts, ETA from the route baseline, off-route
 * confirmation, rerouting controller (debounce, cooldown, backoff, Retry-After, cancellation) and arrival detection.
 *
 * Privacy: everything runs in memory in the browser. The only network call is the injected `fetchRoute` (rerouting), which
 * receives the CURRENT position as the new start; no track/history is kept, stored or put into a URL. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KundeNav = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- geo math ---------------------------------------------------------------------------------------------
  const R = 6371008.8, RAD = Math.PI / 180;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
    const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  /** Smallest absolute difference between two compass angles, 0..180. */
  function angleDiff(a, b) { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; }
  /** Local metric frame around (lat0): good to centimetres over the few hundred metres we use it for. */
  const frame = lat0 => ({kx: Math.cos(lat0 * RAD) * RAD * R, ky: RAD * R});

  // ---- constants --------------------------------------------------------------------------------------------
  const STATES = Object.freeze(['IDLE', 'PREPARING', 'ACTIVE', 'GPS_WEAK', 'OFF_ROUTE', 'REROUTING', 'PAUSED', 'ARRIVED', 'STOPPED', 'ERROR']);
  const TRANSITIONS = Object.freeze({
    IDLE: ['PREPARING'],
    PREPARING: ['ACTIVE', 'GPS_WEAK', 'OFF_ROUTE', 'PAUSED', 'STOPPED', 'ERROR'],
    ACTIVE: ['GPS_WEAK', 'OFF_ROUTE', 'PAUSED', 'ARRIVED', 'STOPPED', 'ERROR'],
    GPS_WEAK: ['ACTIVE', 'OFF_ROUTE', 'PAUSED', 'STOPPED', 'ERROR'],
    OFF_ROUTE: ['REROUTING', 'ACTIVE', 'GPS_WEAK', 'PAUSED', 'ARRIVED', 'STOPPED', 'ERROR'],
    REROUTING: ['ACTIVE', 'OFF_ROUTE', 'GPS_WEAK', 'PAUSED', 'STOPPED', 'ERROR'],
    PAUSED: ['PREPARING', 'STOPPED', 'ERROR'],
    ARRIVED: ['IDLE'], STOPPED: ['IDLE'], ERROR: ['IDLE'],
  });
  const TERMINAL = Object.freeze(['ARRIVED', 'STOPPED', 'ERROR']);

  function createStateMachine(onChange) {
    let state = 'IDLE';
    return {
      get state() { return state; },
      can(next) { return TRANSITIONS[state].includes(next); },
      /** Returns true if the transition happened; illegal transitions are refused (never silently applied). */
      go(next, info) {
        if (state === next) return false;
        if (!TRANSITIONS[state].includes(next)) return false;
        const prev = state; state = next;
        if (onChange) onChange(next, prev, info);
        return true;
      },
    };
  }

  const MODE = {  // thresholds per travel mode (metres, m/s)
    car: {offBase: 35, maxSpeed: 70, arrive: 30, arriveFree: 15, zoom: [[8, 17.5], [18, 16.5], [Infinity, 15.5]], pitch: 50},
    bike: {offBase: 25, maxSpeed: 20, arrive: 20, arriveFree: 12, zoom: [[3, 18], [Infinity, 17]], pitch: 30},
    foot: {offBase: 20, maxSpeed: 8, arrive: 15, arriveFree: 10, zoom: [[Infinity, 18]], pitch: 0},
  };
  const DEFAULTS = Object.freeze({
    maxAccuracy: 100,      // fixes worse than this never move progress
    offAccuracyLimit: 60,  // ...and fixes worse than this never count towards "off route"
    staleMs: 15000,        // a fix older than this (by its own timestamp) is dropped
    lostMs: 8000,          // no usable fix for this long => GPS_WEAK (signal lost)
    outlierConfirm: 3,     // consecutive mutually consistent "jumps" before a teleport is believed
    offConfirmFixes: 3, offConfirmMs: 2000,
    rejoinFixes: 3,
    arriveFixes: 2,
    cooldownMs: 10000, backoffMs: [4000, 8000, 16000, 30000], maxAutoFailures: 4,
    loopWindowMs: 300000, loopMax: 6,
    passM: 12,             // a maneuver is "done" once we are this far past it
  });

  // ---- route index ------------------------------------------------------------------------------------------
  /** Pre-computes cumulative lengths and the along-route position of each step (maneuver point). */
  function createRouteIndex(route) {
    const pts = route.coordinates;
    const cum = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
    const total = cum[pts.length - 1];
    const index = {pts, cum, total, mode: route.mode, apiDistance: route.distance, apiDuration: route.duration, steps: [], destination: pts[pts.length - 1]};
    // Step i's instruction is executed where step i starts (Valhalla), so its along position is the projection of step.location.
    // Search is monotonic so a route that revisits a point does not map a later step to an earlier pass.
    let from = 0;
    const raw = route.steps || [];
    raw.forEach((step, i) => {
      const isLast = i === raw.length - 1 && TYPE_INFO(step.type).arrive;
      const hit = isLast ? {along: total} : projectPoint(index, step.lat, step.lon, from, total, null);
      const along = Math.max(from, hit.along);
      from = along;
      index.steps.push({...step, index: i, along});
    });
    // time at along s: linear inside each step (Valhalla step durations), the baseline for the ETA.
    index.remainingSeconds = along => {
      if (!(total > 0)) return 0;
      const steps = index.steps;
      if (!steps.length) return route.duration * clamp(1 - along / total, 0, 1);
      let sum = 0;
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i], end = i + 1 < steps.length ? steps[i + 1].along : total;
        const len = Math.max(end - s.along, 0.001);
        if (along >= end) continue;
        const left = along <= s.along ? 1 : (end - along) / len;
        sum += s.duration * left;
      }
      // step durations should sum to the route duration; if the API rounded differently, keep the route total authoritative
      const stepTotal = steps.reduce((a, s) => a + s.duration, 0);
      return stepTotal > 0 ? sum * (route.duration / stepTotal) : route.duration * clamp(1 - along / total, 0, 1);
    };
    return index;
  }

  /** Nearest point of the route to (lat, lon) among segments whose along-range intersects [lo, hi]. */
  function projectPoint(index, lat, lon, lo, hi, heading, headingWeight = 20) {
    const {pts, cum} = index, n = pts.length;
    const f = frame(lat);
    // first segment whose end is >= lo
    let a = 0, b = n - 1;
    while (a < b) { const mid = (a + b) >> 1; if (cum[mid + 1] >= lo) b = mid; else a = mid + 1; }
    let best = null;
    for (let i = a; i < n - 1 && cum[i] <= hi; i++) {
      const ax = (pts[i][0] - lon) * f.kx, ay = (pts[i][1] - lat) * f.ky;
      const bx = (pts[i + 1][0] - lon) * f.kx, by = (pts[i + 1][1] - lat) * f.ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? clamp(-(ax * dx + ay * dy) / len2, 0, 1) : 0;
      const px = ax + t * dx, py = ay + t * dy;
      const lateral = Math.hypot(px, py);
      let cost = lateral, headingDiff = null;
      if (heading != null && len2 > 0) {
        headingDiff = angleDiff(heading, (Math.atan2(dx, dy) / RAD + 360) % 360);
        cost += (headingDiff / 180) * headingWeight;   // same place, opposite direction: prefer the leg we are travelling along
      }
      if (!best || cost < best.cost) {
        const segLen = cum[i + 1] - cum[i];
        best = {cost, lateral, segment: i, along: cum[i] + t * segLen, headingDiff,
          lon: pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), lat: pts[i][1] + t * (pts[i + 1][1] - pts[i][1]),
          segBearing: bearing(pts[i][1], pts[i][0], pts[i + 1][1], pts[i + 1][0])};
      }
    }
    return best || {cost: Infinity, lateral: Infinity, segment: 0, along: clamp(lo, 0, index.total), lon, lat, headingDiff: null, segBearing: 0};
  }

  // ---- maneuvers --------------------------------------------------------------------------------------------
  // Valhalla maneuver types -> {icon, key}. Unknown types fall back to the API text (labelled with its language).
  const TYPE_TABLE = {
    0: ['straight', 'straight'], 1: ['depart', 'start'], 2: ['depart', 'start'], 3: ['depart', 'start'],
    4: ['destination', 'arrive'], 5: ['destination', 'arriveRight'], 6: ['destination', 'arriveLeft'],
    7: ['straight', 'straight'], 8: ['straight', 'straight'],
    9: ['slight-right', 'slightRight'], 10: ['right', 'right'], 11: ['sharp-right', 'sharpRight'], 12: ['uturn', 'uturn'], 13: ['uturn', 'uturn'],
    14: ['sharp-left', 'sharpLeft'], 15: ['left', 'left'], 16: ['slight-left', 'slightLeft'],
    17: ['ramp', 'rampStraight'], 18: ['ramp-right', 'rampRight'], 19: ['ramp-left', 'rampLeft'], 20: ['exit-right', 'exitRight'], 21: ['exit-left', 'exitLeft'],
    22: ['straight', 'stayStraight'], 23: ['slight-right', 'stayRight'], 24: ['slight-left', 'stayLeft'],
    25: ['merge', 'merge'], 37: ['merge', 'merge'], 38: ['merge', 'merge'],
    26: ['roundabout', 'roundaboutEnter'], 27: ['roundabout', 'roundaboutExit'], 28: ['ferry', 'ferryEnter'], 29: ['ferry', 'ferryExit'],
  };
  function TYPE_INFO(type) {
    const row = TYPE_TABLE[type];
    return row ? {icon: row[0], key: row[1], known: true, arrive: type >= 4 && type <= 6} : {icon: 'straight', key: null, known: false, arrive: false};
  }

  const NAV_STRINGS = {
    ru: {
      m: 'м', km: 'км', min: 'мин', h: 'ч', inDistance: 'Через {d}', now: 'Сейчас',
      start: 'Начните движение', straight: 'Продолжайте прямо', slightRight: 'Немного правее', right: 'Поверните направо', sharpRight: 'Резко направо',
      uturn: 'Развернитесь', sharpLeft: 'Резко налево', left: 'Поверните налево', slightLeft: 'Немного левее',
      rampStraight: 'Съезжайте на примыкающую дорогу', rampRight: 'Направо на примыкающую дорогу', rampLeft: 'Налево на примыкающую дорогу',
      exitRight: 'Съезд направо', exitLeft: 'Съезд налево', stayStraight: 'Держитесь прямо', stayRight: 'Держитесь правее', stayLeft: 'Держитесь левее',
      merge: 'Перестройтесь в поток', roundaboutEnter: 'Въезд на круговое движение', roundaboutExit: 'Съезд с кругового движения',
      ferryEnter: 'Въезд на паром', ferryExit: 'Съезд с парома',
      arrive: 'Вы прибыли', arriveRight: 'Пункт назначения справа', arriveLeft: 'Пункт назначения слева',
      fallbackLang: 'текст на {l}',
      title: 'Навигация', begin: 'Начать', end: 'Завершить', recenter: 'К моему положению', steps: 'Манёвры', stepsClose: 'Скрыть манёвры',
      eta: 'Прибытие', left_: 'Осталось', distance: 'Расстояние', preparing: 'Ищем ваше положение…', preparingHint: 'Для навигации нужен сигнал GPS',
      gpsWeak: 'Слабый сигнал GPS. Положение приблизительное', gpsLost: 'Сигнал GPS потерян. Ориентируйтесь по дороге и знакам',
      gpsUnavailable: 'GPS недоступен', gpsTimeout: 'GPS не отвечает',
      offRoute: 'Вы отклонились от маршрута', rerouting: 'Перестраиваем маршрут…', reroutingSlow: 'Сервис маршрутов просыпается, подождите…',
      rerouteFailed: 'Не удалось перестроить маршрут', rerouteRateLimited: 'Слишком много запросов. Повтор через {n} с', rerouteUnavailable: 'Сервис маршрутов временно недоступен',
      rerouteLimit: 'Слишком много перестроений подряд', retry: 'Повторить', retrying: 'Повтор через {n} с',
      paused: 'Навигация на паузе: приложение было в фоне', resuming: 'Возвращаем положение…',
      arrived: 'Вы прибыли в пункт назначения', done: 'Готово', stopped: 'Навигация завершена',
      denied: 'Доступ к геолокации запрещён. Разрешите его в настройках браузера и начните снова', unsupported: 'Этот браузер не поддерживает геолокацию',
      error: 'Навигацию не удалось запустить', close: 'Закрыть',
      safety: 'Соблюдайте ПДД и дорожные знаки. Подсказки не заменяют внимание водителя.',
      limits: 'Время рассчитано по данным OpenStreetMap, без пробок и перекрытий. В браузере навигация может остановиться при блокировке экрана.',
      wake: 'Экран не гаснет, пока идёт навигация', follow: 'Следовать за мной', northUp: 'Север сверху', modeOnly: 'Режим',
      noStepText: 'Следуйте по маршруту', endConfirm: 'Точно завершить?', then: 'Затем',
    },
    kk: {
      m: 'м', km: 'км', min: 'мин', h: 'сағ', inDistance: '{d} кейін', now: 'Қазір',
      start: 'Қозғалысты бастаңыз', straight: 'Тура жүріңіз', slightRight: 'Оңға сәл бұрылыңыз', right: 'Оңға бұрылыңыз', sharpRight: 'Оңға күрт бұрылыңыз',
      uturn: 'Кері бұрылыңыз', sharpLeft: 'Солға күрт бұрылыңыз', left: 'Солға бұрылыңыз', slightLeft: 'Солға сәл бұрылыңыз',
      rampStraight: 'Жол тармағына түсіңіз', rampRight: 'Оңға, жол тармағына түсіңіз', rampLeft: 'Солға, жол тармағына түсіңіз',
      exitRight: 'Оңға қарай шығыңыз', exitLeft: 'Солға қарай шығыңыз', stayStraight: 'Тура жүре беріңіз', stayRight: 'Оңға жақын жүріңіз', stayLeft: 'Солға жақын жүріңіз',
      merge: 'Қозғалыс ағынына қосылыңыз', roundaboutEnter: 'Айналмалы қозғалысқа кіріңіз', roundaboutExit: 'Айналмалы қозғалыстан шығыңыз',
      ferryEnter: 'Паромға кіріңіз', ferryExit: 'Паромнан шығыңыз',
      arrive: 'Сіз межелі жерге жеттіңіз', arriveRight: 'Межелі жер оң жақта', arriveLeft: 'Межелі жер сол жақта',
      fallbackLang: '{l} тіліндегі мәтін',
      title: 'Навигация', begin: 'Бастау', end: 'Аяқтау', recenter: 'Менің орныма', steps: 'Маневрлер', stepsClose: 'Маневрлерді жасыру',
      eta: 'Жету уақыты', left_: 'Қалды', distance: 'Қашықтық', preparing: 'Орныңыз анықталуда…', preparingHint: 'Навигация үшін GPS сигналы қажет',
      gpsWeak: 'GPS сигналы әлсіз. Орын шамамен көрсетілген', gpsLost: 'GPS сигналы жоғалды. Жолға және белгілерге қараңыз',
      gpsUnavailable: 'GPS қолжетімсіз', gpsTimeout: 'GPS жауап бермейді',
      offRoute: 'Сіз маршруттан ауытқыдыңыз', rerouting: 'Маршрут қайта құрылуда…', reroutingSlow: 'Маршрут қызметі қосылып жатыр, күте тұрыңыз…',
      rerouteFailed: 'Маршрутты қайта құру мүмкін болмады', rerouteRateLimited: 'Сұраныс тым көп. {n} с кейін қайталаңыз', rerouteUnavailable: 'Маршрут қызметі уақытша қолжетімсіз',
      rerouteLimit: 'Қатарынан тым көп қайта құру', retry: 'Қайталау', retrying: '{n} с кейін қайталанады',
      paused: 'Навигация кідіртілді: қосымша фонда болды', resuming: 'Орын қалпына келтірілуде…',
      arrived: 'Сіз межелі жерге жеттіңіз', done: 'Дайын', stopped: 'Навигация аяқталды',
      denied: 'Геолокацияға рұқсат жоқ. Браузер параметрлерінде рұқсат беріп, қайта бастаңыз', unsupported: 'Бұл браузер геолокацияны қолдамайды',
      error: 'Навигацияны іске қосу мүмкін болмады', close: 'Жабу',
      safety: 'Жол ережелері мен белгілерін сақтаңыз. Нұсқаулар жүргізушінің зейінін алмастырмайды.',
      limits: 'Уақыт OpenStreetMap деректері бойынша есептелген, кептелістер мен жабық жолдар ескерілмейді. Браузерде экран құлыпталғанда навигация тоқтауы мүмкін.',
      wake: 'Навигация кезінде экран өшпейді', follow: 'Менің соңымнан ілесу', northUp: 'Солтүстік жоғарыда', modeOnly: 'Режим',
      noStepText: 'Маршрут бойымен жүріңіз', endConfirm: 'Шынымен аяқтау?', then: 'Содан кейін',
    },
    en: {
      m: 'm', km: 'km', min: 'min', h: 'h', inDistance: 'In {d}', now: 'Now',
      start: 'Start moving', straight: 'Continue straight', slightRight: 'Bear right', right: 'Turn right', sharpRight: 'Sharp right',
      uturn: 'Make a U-turn', sharpLeft: 'Sharp left', left: 'Turn left', slightLeft: 'Bear left',
      rampStraight: 'Take the ramp', rampRight: 'Take the ramp on the right', rampLeft: 'Take the ramp on the left',
      exitRight: 'Take the exit on the right', exitLeft: 'Take the exit on the left', stayStraight: 'Keep straight', stayRight: 'Keep right', stayLeft: 'Keep left',
      merge: 'Merge', roundaboutEnter: 'Enter the roundabout', roundaboutExit: 'Exit the roundabout', ferryEnter: 'Board the ferry', ferryExit: 'Leave the ferry',
      arrive: 'You have arrived', arriveRight: 'Destination on the right', arriveLeft: 'Destination on the left',
      fallbackLang: 'text in {l}',
      title: 'Navigation', begin: 'Start', end: 'End', recenter: 'Recenter', steps: 'Maneuvers', stepsClose: 'Hide maneuvers',
      eta: 'Arrival', left_: 'Left', distance: 'Distance', preparing: 'Finding your position…', preparingHint: 'Navigation needs a GPS signal',
      gpsWeak: 'Weak GPS signal. Position is approximate', gpsLost: 'GPS signal lost. Follow the road and signs',
      gpsUnavailable: 'GPS unavailable', gpsTimeout: 'GPS is not responding',
      offRoute: 'You left the route', rerouting: 'Rerouting…', reroutingSlow: 'The routing service is waking up, please wait…',
      rerouteFailed: 'Could not reroute', rerouteRateLimited: 'Too many requests. Retrying in {n} s', rerouteUnavailable: 'The routing service is temporarily unavailable',
      rerouteLimit: 'Too many reroutes in a row', retry: 'Retry', retrying: 'Retrying in {n} s',
      paused: 'Navigation paused: the app was in the background', resuming: 'Recovering your position…',
      arrived: 'You have arrived at your destination', done: 'Done', stopped: 'Navigation ended',
      denied: 'Location access is blocked. Allow it in the browser settings and start again', unsupported: 'This browser does not support geolocation',
      error: 'Navigation could not be started', close: 'Close',
      safety: 'Obey traffic laws and road signs. Directions do not replace the driver\'s attention.',
      limits: 'Travel time comes from OpenStreetMap data without traffic or closures. In a browser, navigation may stop when the screen locks.',
      wake: 'The screen stays on during navigation', follow: 'Follow me', northUp: 'North up', modeOnly: 'Mode',
      noStepText: 'Follow the route', endConfirm: 'End now?', then: 'Then',
    },
  };
  const navT = (lang, key, params) => {
    let s = (NAV_STRINGS[lang] && NAV_STRINGS[lang][key]) || NAV_STRINGS.ru[key] || key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.replace('{' + k + '}', v);
    return s;
  };

  /** Structured maneuver text. The street is data (OSM name), never translated or invented. */
  function maneuverText(step, lang, narrationLang) {
    const info = TYPE_INFO(step.type);
    if (info.known) {
      let key = info.key;
      if (step.type === 2 || step.type === 3) key = 'start';
      return {icon: info.icon, text: navT(lang, key), street: step.street || '', fallback: null};
    }
    const text = step.instruction || navT(lang, 'noStepText');
    return {icon: info.icon, text, street: step.street || '', fallback: step.instruction && narrationLang && narrationLang !== lang ? narrationLang : null};
  }

  let navUnits = 'metric';
  const setNavUnits = value => { navUnits = value === 'imperial' ? 'imperial' : 'metric'; };
  function formatNavDistance(meters, lang) {
    if (!Number.isFinite(meters) || meters < 0) return '';
    const loc = lang === 'en' ? 'en-US' : 'ru-RU';
    if (navUnits === 'imperial') {
      const miles = meters / 1609.344;
      if (miles < 0.1) return Math.round(meters * 3.28084 / 10) * 10 + ' ' + ({ru: 'фт', kk: 'фут', en: 'ft'}[lang] || 'ft');
      return (miles < 10 ? Math.round(miles * 10) / 10 : Math.round(miles)).toLocaleString(loc, {maximumFractionDigits: 1}) + ' ' + ({ru: 'ми', kk: 'миля', en: 'mi'}[lang] || 'mi');
    }
    if (meters < 1000) {
      const rounded = meters < 100 ? Math.round(meters / 10) * 10 : Math.round(meters / 50) * 50;
      return (rounded >= 1000 ? '1' : String(rounded)) + (rounded >= 1000 ? ' ' + navT(lang, 'km') : ' ' + navT(lang, 'm'));
    }
    const km = meters / 1000;
    return (km < 10 ? Math.round(km * 10) / 10 : Math.round(km)).toLocaleString(loc, {maximumFractionDigits: 1}) + ' ' + navT(lang, 'km');
  }
  function formatNavDuration(seconds, lang) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const total = Math.max(1, Math.round(seconds / 60)), h = Math.floor(total / 60), m = total % 60;
    return h ? h + ' ' + navT(lang, 'h') + (m ? ' ' + String(m).padStart(2, '0') + ' ' + navT(lang, 'min') : '') : m + ' ' + navT(lang, 'min');
  }
  function formatClock(ms, timeZone) {
    return new Intl.DateTimeFormat('ru-RU', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? {timeZone} : {})}).format(new Date(ms));
  }

  // ---- session ----------------------------------------------------------------------------------------------
  /**
   * One navigation session. Dependencies are injected so tests are deterministic:
   *  geo        navigator.geolocation-like {watchPosition, clearWatch}
   *  fetchRoute ({from, to, mode, lang, signal, onSlow}) -> Promise<route> (validated by KundeCore.createRouteClient)
   *  now        () => ms     timers  {setInterval, clearInterval, setTimeout, clearTimeout}
   *  onUpdate   (snapshot) -> void, called after every state or progress change
   */
  function createSession(options) {
    const {geo, fetchRoute, now = () => Date.now(), lang = 'ru', mode = 'car', onUpdate = () => {}, onEvent = () => {}} = options;
    const cfg = {...DEFAULTS, ...(options.config || {})};
    const timers = options.timers || {setInterval: (f, ms) => setInterval(f, ms), clearInterval: id => clearInterval(id),
      setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: id => clearTimeout(id)};
    const m = MODE[mode] || MODE.car;
    let route = options.route, index = createRouteIndex(route);
    const destination = options.destination || {lat: index.destination[1], lon: index.destination[0]};
    let currentLang = lang;

    const machine = createStateMachine((next, prev, info) => { reason = (info && info.reason) || ''; });
    let reason = '';
    let watchId = null, tickId = null, retryTimer = null, abort = null, disposed = false;
    let last = null;                 // last ACCEPTED fix {lat, lon, accuracy, ts, speed, heading, headingReliable}
    let lastTs = -Infinity, lastGoodAt = 0, outliers = [], weakStreak = 0;
    let along = 0, wide = true, match = null;
    let offCount = 0, offSince = 0, rejoinCount = 0, arriveCount = 0, backCount = 0;
    let lastGeoError = null;
    let gpsIssue = null;             // null | 'accuracy' | 'no_signal' | 'unavailable' | 'timeout'
    let reroute = {attempts: 0, failures: 0, lastStart: -Infinity, nextAt: 0, error: null, retryAt: 0, slow: false, count: 0, times: [], manualOnly: false, total: 0};

    function snapshot() {
      const total = index.total, a = clamp(along, 0, total);
      const idx = upcoming(a);
      const step = idx >= 0 ? index.steps[idx] : null;
      const text = step ? maneuverText(step, currentLang, route.narrationLang) : null;
      const next = idx >= 0 && idx + 1 < index.steps.length ? index.steps[idx + 1] : null;
      const nextInfo = next ? maneuverText(next, currentLang, route.narrationLang) : null;
      const remainingM = Math.max(0, total - a), remainingS = index.remainingSeconds(a);
      const t = now();
      return {
        state: machine.state, reason, mode, lang: currentLang, gpsIssue,
        position: last ? {lat: last.lat, lon: last.lon, accuracy: last.accuracy, heading: last.headingReliable ? last.heading : null, speed: last.speed, ts: last.ts} : null,
        snapped: match && match.lateral <= 2000 ? {lat: match.lat, lon: match.lon, bearing: match.segBearing} : null,
        lateral: match ? match.lateral : null,
        progress: {alongM: a, totalM: total, remainingM, remainingS, fraction: total > 0 ? a / total : 0, etaMs: t + remainingS * 1000},
        maneuver: step ? {index: idx, type: step.type, icon: text.icon, text: text.text, street: text.street, fallback: text.fallback, distanceM: Math.max(0, step.along - a), atM: step.along} : null,
        nextManeuver: nextInfo ? {icon: nextInfo.icon, text: nextInfo.text, street: nextInfo.street, distanceM: Math.max(0, next.along - a)} : null,
        remainingSteps: index.steps.slice(Math.max(0, idx)).map((s, i) => ({index: s.index, ...maneuverText(s, currentLang, route.narrationLang), distanceM: Math.max(0, s.along - a), current: i === 0})),
        reroute: {active: machine.state === 'REROUTING', slow: reroute.slow, error: reroute.error, retryInMs: reroute.retryAt ? Math.max(0, reroute.retryAt - t) : 0, manualOnly: reroute.manualOnly, count: reroute.total},
        route: {geometry: index.pts, mode: index.mode, bbox: route.bbox || null, index},
        destination,
      };
    }
    /** Index of the maneuver the driver should prepare for: first step still ahead (or just passed by < passM). */
    function upcoming(a) {
      const steps = index.steps;
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const gone = i === 0 ? a >= 25 : a >= s.along + cfg.passM;
        if (!gone) return i;
      }
      return steps.length ? steps.length - 1 : -1;
    }
    const emit = () => { if (!disposed) onUpdate(snapshot()); };
    const to = (state, info) => { const changed = machine.go(state, info); return changed; };

    function threshold(accuracy) { return m.offBase + clamp(accuracy || 0, 0, cfg.offAccuracyLimit); }

    // -- fix pipeline
    function normalize(raw) {
      if (!raw) return null;
      const c = raw.coords || raw;
      const lat = Number(c.latitude ?? c.lat), lon = Number(c.longitude ?? c.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      const accuracy = Number(c.accuracy);
      const speed = c.speed == null ? NaN : Number(c.speed), heading = c.heading == null ? NaN : Number(c.heading);
      return {lat, lon, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : 9999, speed: Number.isFinite(speed) && speed >= 0 ? speed : null,
        heading: Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : null, ts: Number(raw.timestamp) || now()};
    }
    function acceptFix(fix) {
      // speed / heading: device values when sane, else derived from the previous accepted fix
      let speed = fix.speed, heading = fix.heading, reliable = false;
      if (last) {
        const dt = (fix.ts - last.ts) / 1000, d = haversine(last.lat, last.lon, fix.lat, fix.lon);
        if (dt > 0.2) {
          if (speed == null) speed = d / dt;
          if ((heading == null || !(speed > 1)) && d > Math.max(6, fix.accuracy * 0.5, last.accuracy * 0.5)) { heading = bearing(last.lat, last.lon, fix.lat, fix.lon); reliable = true; }
        }
      }
      if (heading != null && speed != null && speed > 1.2) reliable = true;
      if (!reliable && last && last.headingReliable && (speed == null || speed < 1.2)) { heading = last.heading; reliable = true; }   // stopped: keep last known direction
      last = {...fix, speed: speed == null ? 0 : speed, heading: heading == null ? 0 : heading, headingReliable: reliable};
    }

    function handleFix(raw) {
      if (disposed || TERMINAL.includes(machine.state) || machine.state === 'IDLE' || machine.state === 'PAUSED') return false;
      const fix = normalize(raw);
      if (!fix) return false;
      const t = now();
      if (fix.ts < lastTs || t - fix.ts > cfg.staleMs) { return false; }  // stale or out of order: never moves the marker
      lastTs = fix.ts;
      if (fix.accuracy > cfg.maxAccuracy) {
        weakStreak++;
        if (weakStreak >= 3) setGps('accuracy');
        emit(); return false;
      }
      weakStreak = 0;
      // GPS jump: implausible speed since the last accepted fix. A real teleport (tunnel exit) is believed once it repeats consistently.
      if (last) {
        const dt = Math.max((fix.ts - last.ts) / 1000, 0.05), d = haversine(last.lat, last.lon, fix.lat, fix.lon);
        if (d / dt > m.maxSpeed && d > 60 + fix.accuracy) {
          const ref = outliers[0];
          if (ref && haversine(ref.lat, ref.lon, fix.lat, fix.lon) > 50 + fix.accuracy) outliers = [];
          outliers.push(fix);
          if (outliers.length < cfg.outlierConfirm) { return false; }
          outliers = []; last = null; wide = true;   // believed: restart from this fix, search the whole route again
        } else outliers = [];
      }
      acceptFix(fix);
      lastGoodAt = t;
      if (gpsIssue) gpsIssue = null;
      process(fix);
      return true;
    }
    function setGps(issue) {
      gpsIssue = issue;
      if (['ACTIVE', 'OFF_ROUTE', 'REROUTING', 'PREPARING'].includes(machine.state)) { to('GPS_WEAK', {reason: issue}); }
      emit();
    }

    function process(fix) {
      const hd = last.headingReliable ? last.heading : null;
      // 1) match: a window around the known progress; the whole route after a resume, a believed jump or an unmatched start
      let m1;
      if (wide) m1 = projectPoint(index, fix.lat, fix.lon, 0, index.total, hd);
      else m1 = projectPoint(index, fix.lat, fix.lon, Math.max(0, along - 30), along + Math.max(400, (last.speed || 0) * 12 + fix.accuracy * 4), hd);
      const limit = threshold(fix.accuracy);
      let onRoute = m1.lateral <= limit;
      if (!onRoute && !wide) {
        // outside the window nothing fits; look at the whole route to tell "rejoined a later part" from "really off"
        const g = projectPoint(index, fix.lat, fix.lon, 0, index.total, hd);
        if (g.lateral <= limit && (g.headingDiff == null || g.headingDiff < 100)) {
          if (g.along > along) rejoinCount++; else rejoinCount = 0;
          if (rejoinCount >= cfg.rejoinFixes) { m1 = g; onRoute = true; }
        } else rejoinCount = 0;
      }
      match = m1;
      if (onRoute) {
        rejoinCount = 0;
        if (wide) { along = m1.along; wide = false; } else along = Math.max(along, m1.along);   // noise never moves progress backwards
        match = {...m1, along};
        offCount = 0; offSince = 0;
      } else if (fix.accuracy <= cfg.offAccuracyLimit) {
        if (!offCount) offSince = fix.ts;
        offCount++;
      }
      // 2) state
      const s = machine.state;
      backCount = onRoute ? backCount + 1 : 0;
      if (onRoute && (s === 'PREPARING' || s === 'GPS_WEAK' || ((s === 'OFF_ROUTE' || s === 'REROUTING') && backCount >= 2))) {
        if (s === 'REROUTING' || s === 'OFF_ROUTE') cancelReroute();   // back on the road for two fixes: the reroute is no longer needed
        to('ACTIVE');
      } else if (!onRoute && offCount >= cfg.offConfirmFixes && fix.ts - offSince >= cfg.offConfirmMs) {
        if (s === 'ACTIVE' || s === 'PREPARING' || s === 'GPS_WEAK') { to('OFF_ROUTE'); onEvent({type: 'off_route'}); }
      }
      // 3) arrival: progress at the end of the route, ON the route (a parallel road does not count), repeated. Walking up to a
      //    destination that is not on a road also counts when we are clearly there.
      const remaining = index.total - along;
      const dDest = haversine(fix.lat, fix.lon, destination.lat, destination.lon);
      const arriveR = Math.max(m.arrive, Math.min(fix.accuracy, 50));
      const near = (onRoute && remaining <= arriveR) || (dDest <= Math.max(m.arriveFree, Math.min(fix.accuracy, 30)) && fix.accuracy <= 40);
      arriveCount = near ? arriveCount + 1 : 0;
      if (arriveCount >= cfg.arriveFixes && ['ACTIVE', 'OFF_ROUTE', 'GPS_WEAK', 'REROUTING'].includes(machine.state)) {
        if (machine.state === 'REROUTING') cancelReroute();
        if (machine.state === 'GPS_WEAK') to('ACTIVE');
        if (machine.state === 'REROUTING') to('OFF_ROUTE');
        if (to('ARRIVED')) { onEvent({type: 'arrived'}); finish(); }
      }
      if (machine.state === 'OFF_ROUTE') maybeReroute();
      emit();
    }

    // -- rerouting controller
    function maybeReroute(manual) {
      if (machine.state !== 'OFF_ROUTE' || !last || abort) return;
      const t = now();
      reroute.times = reroute.times.filter(x => t - x < cfg.loopWindowMs);
      if (!manual && (reroute.manualOnly)) return;
      if (t < reroute.nextAt) { scheduleRetry(); return; }
      if (reroute.times.length >= cfg.loopMax && !manual) { reroute.manualOnly = true; reroute.error = 'too_many'; onEvent({type: 'reroute_limited'}); emit(); return; }
      startReroute(manual);
    }
    function scheduleRetry() {
      if (retryTimer || reroute.manualOnly) return;
      const wait = Math.max(0, reroute.nextAt - now());
      reroute.retryAt = reroute.nextAt;
      retryTimer = timers.setTimeout(() => { retryTimer = null; reroute.retryAt = 0; maybeReroute(); }, wait + 5);
    }
    function startReroute() {
      const t = now();
      reroute.lastStart = t; reroute.nextAt = t + cfg.cooldownMs; reroute.times.push(t); reroute.error = null; reroute.slow = false; reroute.retryAt = 0;
      if (!to('REROUTING')) return;
      const controller = new AbortController(); abort = controller;
      const from = {lat: last.lat, lon: last.lon};
      emit();
      let pending;
      try { pending = Promise.resolve(fetchRoute({from, to: destination, mode, lang: currentLang, signal: controller.signal, onSlow: () => { if (abort === controller) { reroute.slow = true; emit(); } }})); }
      catch (error) { pending = Promise.reject(error); }
      pending
        .then(newRoute => {
          if (abort !== controller || disposed) return;
          abort = null;
          if (machine.state !== 'REROUTING') return;
          route = newRoute; index = createRouteIndex(newRoute); along = 0; wide = true; match = null; offCount = 0; offSince = 0; rejoinCount = 0; arriveCount = 0;
          reroute.failures = 0; reroute.error = null; reroute.slow = false; reroute.total++;
          to('ACTIVE'); onEvent({type: 'rerouted'});
          if (last) process({...last});   // place the user on the new geometry immediately
          else emit();
        })
        .catch(error => {
          if (abort !== controller || disposed) return;
          abort = null;
          if (error && error.code === 'aborted') return;
          reroute.failures++; reroute.slow = false;
          const code = error && error.code;
          reroute.error = code === 'rate_limited' ? 'rate_limited' : (error && error.detail ? 'no_route' : 'unavailable');
          const wait = code === 'rate_limited' ? Math.max(1, Math.min(error.retryAfter || 10, 120)) * 1000 : cfg.backoffMs[Math.min(reroute.failures - 1, cfg.backoffMs.length - 1)];
          reroute.nextAt = now() + Math.max(wait, cfg.cooldownMs);
          if (reroute.failures >= cfg.maxAutoFailures || error?.code === 'bad_request' || error?.code === 'not_found') reroute.manualOnly = true;
          if (machine.state === 'REROUTING') to('OFF_ROUTE');
          onEvent({type: 'reroute_failed', code: reroute.error});
          if (!reroute.manualOnly) scheduleRetry(); else reroute.retryAt = 0;
          emit();
        });
    }
    function cancelReroute() {
      if (abort) { abort.abort(); abort = null; }
      if (retryTimer) { timers.clearTimeout(retryTimer); retryTimer = null; }
      reroute.error = null; reroute.slow = false; reroute.retryAt = 0; reroute.manualOnly = false; reroute.failures = 0;
    }

    // -- watchdog and geolocation callbacks
    function tick() {
      if (disposed) return;
      const s = machine.state, t = now();
      if ((['ACTIVE', 'OFF_ROUTE', 'REROUTING', 'PREPARING'].includes(s) || (s === 'GPS_WEAK' && gpsIssue !== 'accuracy')) && t - lastGoodAt > cfg.lostMs) {
        // transient geolocation errors between good fixes are common and must not flicker the UI; only a sustained silence is reported
        const recent = lastGeoError && t - lastGeoError.at < cfg.lostMs * 2;
        setGps(recent ? (lastGeoError.code === 3 ? 'timeout' : 'unavailable') : 'no_signal');
      } else if (s === 'OFF_ROUTE' || s === 'REROUTING' || s === 'GPS_WEAK') emit();   // keeps the retry countdown fresh
    }
    function onGeoError(error) {
      if (disposed) return;
      const code = error && error.code;
      if (code === 1) { fail('denied'); return; }
      lastGeoError = {code, at: now()};
    }
    function fail(why) {
      if (to('ERROR', {reason: why})) { onEvent({type: 'error', reason: why}); finish(); emit(); }
    }

    // -- lifecycle
    function start() {
      if (disposed || machine.state !== 'IDLE') return false;
      if (!geo || typeof geo.watchPosition !== 'function') { machine.go('PREPARING'); fail('unsupported'); return false; }
      machine.go('PREPARING');
      lastGoodAt = now();
      try {
        watchId = geo.watchPosition(handleFix, onGeoError, {enableHighAccuracy: true, maximumAge: 0, timeout: 15000});
      } catch (e) { fail('unsupported'); return false; }
      tickId = timers.setInterval(tick, 1000);
      emit();
      return true;
    }
    function release() {
      if (watchId != null && geo && geo.clearWatch) { try { geo.clearWatch(watchId); } catch (_) { /* already gone */ } }
      watchId = null;
      if (tickId != null) { timers.clearInterval(tickId); tickId = null; }
      if (retryTimer) { timers.clearTimeout(retryTimer); retryTimer = null; }
      if (abort) { abort.abort(); abort = null; }
    }
    /** Frees watcher, timers and requests; drops the position. Idempotent. */
    function finish() { release(); last = null; match = null; outliers = []; }
    function stop() {
      if (disposed) return;
      if (!TERMINAL.includes(machine.state) && machine.state !== 'IDLE') to('STOPPED');
      else if (machine.state === 'IDLE') machine.go('PREPARING') && machine.go('STOPPED');
      finish(); emit(); disposed = true;
    }
    function pause() {
      if (disposed || !['ACTIVE', 'GPS_WEAK', 'OFF_ROUTE', 'REROUTING', 'PREPARING'].includes(machine.state)) return false;
      if (abort) { abort.abort(); abort = null; }
      if (retryTimer) { timers.clearTimeout(retryTimer); retryTimer = null; }
      to('PAUSED'); emit(); return true;
    }
    /** Back from the background: forget the last fix (it is stale), search the whole route once, wait for a fresh fix. */
    function resume() {
      if (disposed || machine.state !== 'PAUSED') return false;
      last = null; outliers = []; wide = true; offCount = 0; offSince = 0; rejoinCount = 0; arriveCount = 0; weakStreak = 0;
      lastGoodAt = now(); lastTs = now() - cfg.staleMs;
      reroute.nextAt = 0; reroute.error = null; reroute.manualOnly = false; reroute.failures = 0;
      to('PREPARING', {reason: 'resume'}); emit(); return true;
    }
    function retryReroute() {
      if (machine.state !== 'OFF_ROUTE') return false;
      reroute.manualOnly = false; reroute.failures = 0; reroute.nextAt = Math.min(reroute.nextAt, now() + 1000); reroute.error = null;
      if (retryTimer) { timers.clearTimeout(retryTimer); retryTimer = null; }
      reroute.times = [];
      maybeReroute(true); emit(); return true;
    }
    function setLang(next) { currentLang = next; emit(); }

    return {start, stop, pause, resume, retryReroute, setLang, handleFix, onGeoError, tick, snapshot,
      get state() { return machine.state; }, get active() { return !disposed && !TERMINAL.includes(machine.state) && machine.state !== 'IDLE'; },
      get index() { return index; }};
  }

  /** At most one active session: starting a new one stops the previous (no duplicated GPS watchers). */
  function createManager() {
    let current = null;
    return {
      start(options) {
        if (current) current.stop();
        current = createSession(options);
        current.start();
        return current;
      },
      stop() { if (current) { current.stop(); current = null; } },
      get current() { return current; },
    };
  }

  /** Splits the route geometry at `along` metres: [travelled, remaining], both GeoJSON coordinate arrays sharing the split point. */
  function splitRoute(index, alongM) {
    const {pts, cum, total} = index, s = clamp(alongM, 0, total);
    let i = 0, b = pts.length - 1;
    while (i < b) { const mid = (i + b + 1) >> 1; if (cum[mid] <= s) i = mid; else b = mid - 1; }
    if (i >= pts.length - 1) return [pts.slice(), [pts[pts.length - 1], pts[pts.length - 1]]];
    const t = (s - cum[i]) / Math.max(cum[i + 1] - cum[i], 1e-9);
    const cut = [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])];
    return [pts.slice(0, i + 1).concat([cut]), [cut].concat(pts.slice(i + 1))];
  }

  /** Camera target for the snapshot: where to look, with what bearing and zoom (map-library independent). */
  function cameraTarget(snap, prefs = {}) {
    const p = snap.position; if (!p) return null;
    const mm = MODE[snap.mode] || MODE.car;
    const speed = p.speed || 0;
    const zoom = (mm.zoom.find(([max]) => speed < max) || mm.zoom[mm.zoom.length - 1])[1];
    const headingUp = prefs.headingUp !== false && p.heading != null;
    const near = snap.maneuver && snap.maneuver.distanceM < 120 ? 0.6 : 0;   // approaching a turn: zoom in a little
    return {lat: p.lat, lon: p.lon,
      bearing: headingUp ? p.heading : 0, pitch: headingUp ? mm.pitch : 0, zoom: zoom + near, headingUp};
  }

  return {haversine, bearing, angleDiff, clamp, STATES, TRANSITIONS, TERMINAL, createStateMachine, createRouteIndex, projectPoint, createSession, createManager,
    cameraTarget, splitRoute, maneuverText, TYPE_INFO, NAV_STRINGS, navT, formatNavDistance, setNavUnits, formatNavDuration, formatClock, DEFAULTS, MODE};
});

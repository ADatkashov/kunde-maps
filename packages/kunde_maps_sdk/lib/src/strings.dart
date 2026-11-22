/// Localized texts the SDK itself needs (navigation prompts, picker labels,
/// error messages) in Russian, Kazakh and English. Host apps keep their own
/// strings for everything else.
class MapsStrings {
  const MapsStrings(this.language);

  final String language;

  String call(String key) {
    final values = _labels[key];
    if (values == null) return key;
    return values[switch (language) {
      'ru' => 0,
      'kk' => 1,
      _ => 2,
    }];
  }

  /// Message for a [MapsException.code].
  String error(String code) => this(switch (code) {
    'timeout' || 'network' => 'errNetwork',
    'rate' => 'errRate',
    'access' => 'errAccess',
    'service' || 'missing' => 'errService',
    'routeNotFound' => 'errNoRoute',
    'routeNoRoad' => 'errNoRoad',
    'routeCoverage' => 'errCoverage',
    'routeTooClose' => 'errTooClose',
    'routeTooLong' => 'errTooLong',
    'disabled' => 'errDisabled',
    _ => 'errInvalid',
  });

  static const _labels = <String, List<String>>{
    'navTitle': ['KUNDE Maps', 'KUNDE Maps', 'KUNDE Maps'],
    'navText': ['Навигатор', 'Навигатор', 'Navigate'],
    'arrived': ['Вы прибыли', 'Межелі жерге жеттіңіз', 'You have arrived'],
    'destinationAhead': [
      'Пункт назначения впереди',
      'Межелі орын алда',
      'Destination ahead',
    ],
    'm': ['м', 'м', 'm'],
    'in': ['Через', 'Кейін', 'In'],
    'straight': ['Продолжайте прямо', 'Тура жүріңіз', 'Continue straight'],
    'right': ['Поверните направо', 'Оңға бұрылыңыз', 'Turn right'],
    'left': ['Поверните налево', 'Солға бұрылыңыз', 'Turn left'],
    'uturn': ['Развернитесь', 'Кері бұрылыңыз', 'Make a U-turn'],
    'roundabout': [
      'Въезжайте на круговое движение',
      'Айналмалы қозғалысқа кіріңіз',
      'Enter the roundabout',
    ],
    'exit': ['Съезжайте', 'Түсіңіз', 'Take the exit'],
    'search': ['Адрес или место', 'Мекенжай немесе орын', 'Address or place'],
    'noResults': ['Ничего не найдено', 'Ештеңе табылмады', 'Nothing found'],
    'myLocation': ['Моё местоположение', 'Менің орным', 'My location'],
    'pickOnMap': ['Выбрать на карте', 'Картадан таңдау', 'Pick on map'],
    'confirm': ['Подтвердить', 'Растау', 'Confirm'],
    'gpsOff': [
      'Включите геолокацию',
      'Геолокацияны қосыңыз',
      'Turn location on',
    ],
    'gpsDenied': [
      'Нет доступа к геолокации',
      'Геолокацияға рұқсат жоқ',
      'Location access is denied',
    ],
    'distance': ['Расстояние', 'Қашықтық', 'Distance'],
    'duration': ['В пути', 'Жолда', 'Travel time'],
    'arrival': ['Прибытие', 'Келу уақыты', 'Arrival'],
    'typicalTime': [
      'Типичное время без учёта пробок',
      'Кептелісті ескермейтін әдеттегі уақыт',
      'Typical time, traffic not included',
    ],
    'errNetwork': [
      'Нет соединения. Проверьте интернет и повторите.',
      'Байланыс жоқ. Интернетті тексеріп, қайталаңыз.',
      'No connection. Check the internet and retry.',
    ],
    'errRate': [
      'Слишком много запросов. Повторите через минуту.',
      'Сұраныс тым көп. Бір минуттан кейін қайталаңыз.',
      'Too many requests. Try again in a minute.',
    ],
    'errAccess': [
      'Нет доступа к картам.',
      'Карталарға қолжетімділік жоқ.',
      'Maps access is not allowed.',
    ],
    'errService': [
      'Карты временно недоступны.',
      'Карталар уақытша қолжетімсіз.',
      'Maps are temporarily unavailable.',
    ],
    'errNoRoute': [
      'Маршрут не найден.',
      'Бағыт табылмады.',
      'No route was found.',
    ],
    'errNoRoad': [
      'Рядом с точкой нет дороги.',
      'Нүктеге жақын жол жоқ.',
      'There is no road near the point.',
    ],
    'errCoverage': [
      'Точка вне зоны покрытия (Казахстан).',
      'Нүкте қамту аймағынан тыс (Қазақстан).',
      'The point is outside coverage (Kazakhstan).',
    ],
    'errTooClose': [
      'Точки слишком близко.',
      'Нүктелер тым жақын.',
      'The points are too close.',
    ],
    'errTooLong': [
      'Маршрут слишком длинный.',
      'Бағыт тым ұзын.',
      'The route is too long.',
    ],
    'errDisabled': [
      'Функция отключена.',
      'Функция өшірілген.',
      'This feature is turned off.',
    ],
    'errInvalid': [
      'Неожиданный ответ сервиса.',
      'Қызметтің күтпеген жауабы.',
      'Unexpected service response.',
    ],
  };
}

class Words {
  const Words(this.language);
  final String language;
  String call(String key) {
    final values = labels[key];
    return values?[language == 'ru'
            ? 0
            : language == 'kk'
            ? 1
            : 2] ??
        key;
  }
}

const labels = <String, List<String>>{
  'search': ['Поиск', 'Іздеу', 'Search'],
  'directions': ['Проезд', 'Бағыт', 'Directions'],
  'nav': ['Навигатор', 'Навигатор', 'Navigate'],
  'saved': ['Избранное', 'Таңдаулылар', 'Saved'],
  'profile': ['Профиль', 'Профиль', 'Profile'],
  'hint': ['Адрес или место', 'Мекенжай немесе орын', 'Address or place'],
  'near': ['Рядом', 'Маңайда', 'Nearby'],
  'locate': ['Моё местоположение', 'Менің орным', 'My location'],
  'place': ['Место', 'Орын', 'Place'],
  'pick': ['Выбрать на карте', 'Картадан таңдау', 'Pick on map'],
  'tap': [
    'Коснитесь точки на карте',
    'Картадағы нүктені басыңыз',
    'Tap a point on the map',
  ],
  'origin': ['Откуда', 'Қайдан', 'From'],
  'destination': ['Куда', 'Қайда', 'To'],
  'swap': ['Поменять точки', 'Орындарын ауыстыру', 'Swap points'],
  'car': ['Авто', 'Көлік', 'Drive'],
  'foot': ['Пешком', 'Жаяу', 'Walk'],
  'bike': ['Велосипед', 'Велосипед', 'Cycle'],
  'build': ['Построить маршрут', 'Бағыт құру', 'Build route'],
  'start': ['Начать навигацию', 'Навигацияны бастау', 'Start navigation'],
  'stop': ['Завершить', 'Аяқтау', 'End navigation'],
  'destinationAhead': [
    'Пункт назначения впереди',
    'Межелі орын алда',
    'Destination ahead',
  ],
  'arrived': ['Вы прибыли', 'Межелі жерге жеттіңіз', 'You have arrived'],
  'following': ['По маршруту', 'Бағыт бойынша', 'On route'],
  'reroute': [
    'Перестраиваем маршрут',
    'Бағыт қайта есептелуде',
    'Finding a new route',
  ],
  'weak': [
    'Ожидаем точный сигнал GPS',
    'Дәл GPS сигналы күтілуде',
    'Waiting for an accurate GPS fix',
  ],
  'gps': [
    'Включите геолокацию и разрешите доступ в настройках',
    'Геолокацияны қосып, баптауларда рұқсат беріңіз',
    'Enable location and grant access in Settings',
  ],
  'empty': ['Ничего не найдено', 'Ештеңе табылмады', 'No results'],
  'network': [
    'Нет связи. Проверьте подключение',
    'Байланыс жоқ. Қосылымды тексеріңіз',
    'Connection lost. Check your network',
  ],
  'timeout': [
    'Сервер отвечает слишком долго',
    'Сервер тым ұзақ жауап беруде',
    'The server is taking too long',
  ],
  'service': [
    'Сервис временно недоступен',
    'Қызмет уақытша қолжетімсіз',
    'Service temporarily unavailable',
  ],
  'rate': [
    'Слишком много запросов. Повторите позже',
    'Сұрау тым көп. Кейін қайталаңыз',
    'Too many requests. Try again later',
  ],
  'access': [
    'Доступ к сервису ограничен',
    'Қызметке кіру шектелген',
    'Service access is restricted',
  ],
  'missing': ['Не найдено', 'Табылмады', 'Not found'],
  'invalid': [
    'Не удалось обработать запрос',
    'Сұрауды өңдеу мүмкін болмады',
    'Could not process the request',
  ],
  'retry': ['Повторить', 'Қайталау', 'Retry'],
  'close': ['Закрыть', 'Жабу', 'Close'],
  'save': ['Сохранить', 'Сақтау', 'Save'],
  'remove': [
    'Удалить из избранного',
    'Таңдаулылардан өшіру',
    'Remove from saved',
  ],
  'share': ['Поделиться', 'Бөлісу', 'Share'],
  'language': ['Язык', 'Тіл', 'Language'],
  'theme': ['Тема', 'Тақырып', 'Theme'],
  'system': ['Системная', 'Жүйелік', 'System'],
  'light': ['Светлая', 'Ашық', 'Light'],
  'dark': ['Тёмная', 'Қараңғы', 'Dark'],
  'units': ['Единицы измерения', 'Өлшем бірліктері', 'Distance units'],
  'voice': ['Голосовые подсказки', 'Дауыстық нұсқаулар', 'Voice guidance'],
  'noVoice': [
    'Системный голос недоступен. Следуйте подсказкам на экране.',
    'Жүйелік дауыс қолжетімсіз. Экрандағы нұсқауларды орындаңыз.',
    'System voice unavailable. Follow guidance on screen.',
  ],
  'privacy': [
    'GPS нужен для определения позиции и навигации. При активной поездке GPS работает в фоне. История перемещений не сохраняется.',
    'GPS орынды анықтау және навигация үшін қажет. Белсенді сапарда GPS фондық режимде жұмыс істейді. Қозғалыс тарихы сақталмайды.',
    'Location is used to find your position and guide your trip. GPS can run in the background during an active trip. No location history is stored.',
  ],
  'notificationsOff': [
    'Разрешите уведомления для навигации в фоне.',
    'Фондық навигация үшін хабарландыруға рұқсат беріңіз.',
    'Allow notifications for background navigation.',
  ],
  'permissions': [
    'Настройки разрешений',
    'Рұқсат баптаулары',
    'Permission settings',
  ],
  'traffic': [
    'Расчёт без учёта пробок',
    'Кептеліс есепке алынбайды',
    'Estimate excludes traffic',
  ],
  'minutes': ['мин', 'мин', 'min'],
  'km': ['км', 'км', 'km'],
  'mi': ['мили', 'миль', 'mi'],
  'm': ['м', 'м', 'm'],
  'ft': ['фут', 'фут', 'ft'],
  'in': ['Через', 'Кейін', 'In'],
  'straight': ['Продолжайте прямо', 'Тура жүріңіз', 'Continue straight'],
  'right': ['Поверните направо', 'Оңға бұрылыңыз', 'Turn right'],
  'left': ['Поверните налево', 'Солға бұрылыңыз', 'Turn left'],
  'uturn': ['Развернитесь', 'Кері бұрылыңыз', 'Make a U-turn'],
  'roundabout': [
    'Въезжайте на круг',
    'Айналма жолға кіріңіз',
    'Enter the roundabout',
  ],
  'exit': [
    'Съезжайте с круга',
    'Айналма жолдан шығыңыз',
    'Exit the roundabout',
  ],
  'restaurant': ['Рестораны', 'Мейрамханалар', 'Restaurants'],
  'cafe': ['Кафе', 'Кафелер', 'Cafés'],
  'shop': ['Магазины', 'Дүкендер', 'Shops'],
  'pharmacy': ['Аптеки', 'Дәріханалар', 'Pharmacies'],
  'hospital': ['Больницы', 'Ауруханалар', 'Hospitals'],
  'school': ['Школы', 'Мектептер', 'Schools'],
  'fuel': ['АЗС', 'ЖҚС', 'Fuel'],
  'parking': ['Парковки', 'Тұрақтар', 'Parking'],
  'bank': ['Банки и банкоматы', 'Банктер мен банкоматтар', 'Banks and ATMs'],
  'hotel': ['Отели', 'Қонақүйлер', 'Hotels'],
  'beauty': ['Красота', 'Сұлулық', 'Beauty'],
  'sport': ['Спорт', 'Спорт', 'Sports'],
  'culture': ['Культура', 'Мәдениет', 'Culture'],
  'park': ['Парки', 'Саябақтар', 'Parks'],
  'auto': ['Автосервис', 'Автосервис', 'Auto services'],
  'transport': ['Транспорт', 'Көлік', 'Transport'],
  'services': ['Услуги', 'Қызметтер', 'Services'],
};

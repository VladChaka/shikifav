import json, random
import os
# Промежуточные файлы лежат рядом со скриптами — там же их ищет
# capture.py, и ровно эти пути перечислены в .gitignore. Каталог
# запуска роли не играет: README зовёт скрипты из корня репозитория.
HERE = os.path.dirname(os.path.abspath(__file__))

d = json.load(open(f'{HERE}/demo-data.json'))
random.seed(7)

def poster(a):
    p = a.get('poster') or {}
    return p.get('miniUrl'), p.get('mini2xUrl')

def card(a):
    u1, u2 = poster(a)
    return {'id': a['id'], 'targetType': 'Anime', 'name': a['name'], 'russian': a['russian'],
            'kind': a.get('kind'), 'score': a.get('score'), 'status': a.get('status'),
            'episodes': a.get('episodes', 0), 'episodesAired': a.get('episodesAired', 0),
            'year': (a.get('airedOn') or {}).get('year'), 'posterUrl': u1, 'posterUrl2x': u2,
            'userRate': None, 'url': a.get('url')}

# Поиск: у двух карточек — мой статус, чтобы был виден бейдж.
search_items = [card(a) for a in d['search']]
if len(search_items) > 0:
    search_items[0]['userRate'] = {'id': '901', 'status': 'watching', 'episodes': 7, 'score': 9}
if len(search_items) > 2:
    search_items[2]['userRate'] = {'id': '902', 'status': 'planned', 'episodes': 0, 'score': 0}

# Мои списки: «Смотрю», с прогрессом и оценками.
rows = []
for i, a in enumerate(d['popular'][:8]):
    u1, u2 = poster(a)
    total = a.get('episodes') or 0
    rows.append({'rateId': str(1000 + i), 'targetId': a['id'], 'targetType': 'Anime',
                 'name': a['name'], 'russian': a['russian'], 'posterUrl': u1, 'posterUrl2x': u2,
                 'status': 'watching', 'score': random.choice([0, 7, 8, 9, 10]),
                 'progress': max(1, (total // 3) or random.randint(3, 20)),
                 'total': total, 'url': a.get('url')})

# Календарь: реальные даты следующих серий.
cal = []
for i, a in enumerate(d['ongoing']):
    u1, u2 = poster(a)
    aired = a.get('episodesAired') or 0
    cal.append({'rateId': str(2000 + i), 'targetId': a['id'], 'name': a['name'], 'russian': a['russian'],
                'status': 'watching' if i % 3 else 'planned', 'posterUrl': u1, 'posterUrl2x': u2,
                'nextEpisodeAt': a.get('nextEpisodeAt'), 'episodes': a.get('episodes') or 0,
                'episodesAired': aired, 'progress': max(0, aired - (i % 4)), 'url': a.get('url')})

seed = {
  'local': {
    'auth': {'accessToken': 'demo-token', 'refreshToken': 'demo-refresh',
             'expiresAt': 4102444800000,
             'user': {'id': 1, 'nickname': 'shikifav',
                      'avatarUrl': "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56'><circle cx='28' cy='28' r='28' fill='%231a7f5a'/><text x='28' y='38' font-family='system-ui,sans-serif' font-size='26' font-weight='700' fill='%23ffffff' text-anchor='middle'>S</text></svg>"}},
    'settings': {'origin': 'https://shikimori.io', 'titleLang': 'ru', 'theme': 'system',
                 'startTab': 'last', 'quickStatus': 'planned', 'defaultSearchType': 'anime',
                 'defaultListStatus': 'watching'},
  },
  'session': {
    'lastTab': 'search',
    'lastSearch': {'query': 'kimetsu', 'type': 'anime', 'items': search_items},
    'lastList': {'type': 'anime', 'status': 'watching', 'items': rows, 'page': 1, 'hasMore': True},
    'lastCalendar': {'items': cal, 'fetchedAt': 0},
  },
}
json.dump(seed, open(f'{HERE}/seed.json','w'), ensure_ascii=False)
print('поиск:', len(search_items), '| строк списка:', len(rows), '| календарь:', len(cal))

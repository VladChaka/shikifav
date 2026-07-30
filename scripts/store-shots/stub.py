import json, random
d = json.load(open('demo-data.json')); random.seed(11)

def p(a):
    q = a.get('poster') or {}
    return {'miniUrl': q.get('miniUrl'), 'mini2xUrl': q.get('mini2xUrl')} if q else None

def mylist(a, i):
    total = a.get('episodes') or 0
    return {'id': a['id'], 'name': a['name'], 'russian': a['russian'], 'episodes': total,
            'episodesAired': total, 'poster': p(a), 'url': a.get('url'),
            'userRate': {'id': str(1000 + i), 'status': 'watching',
                         'episodes': max(1, (total // 3) or random.randint(3, 20)),
                         'score': random.choice([0, 7, 8, 9, 10])}}

def calendar(a, i):
    aired = a.get('episodesAired') or 0
    return {'id': a['id'], 'name': a['name'], 'russian': a['russian'], 'status': 'ongoing',
            'episodes': a.get('episodes') or 0, 'episodesAired': aired,
            'nextEpisodeAt': a.get('nextEpisodeAt'), 'poster': p(a), 'url': a.get('url'),
            'userRate': {'id': str(2000 + i), 'status': 'watching' if i % 3 else 'planned',
                         'episodes': max(0, aired - (i % 4))}}

def search(a, i):
    r = {'id': a['id'], 'malId': None, 'name': a['name'], 'russian': a['russian'],
         'kind': a.get('kind'), 'score': a.get('score'), 'status': a.get('status'),
         'episodes': a.get('episodes') or 0, 'episodesAired': a.get('episodesAired') or 0,
         'airedOn': a.get('airedOn'), 'poster': p(a), 'url': a.get('url'), 'userRate': None}
    if i == 0: r['userRate'] = {'id': '901', 'status': 'watching', 'episodes': 7, 'score': 9}
    if i == 2: r['userRate'] = {'id': '902', 'status': 'planned', 'episodes': 0, 'score': 0}
    return r

json.dump({
  'SearchAnimes':  {'data': {'animes': [search(a, i) for i, a in enumerate(d['search'])]}},
  'MylistAnimes':  {'data': {'animes': [mylist(a, i) for i, a in enumerate(d['popular'][:8])]}},
  'CalendarAnimes':{'data': {'animes': [calendar(a, i) for i, a in enumerate(d['ongoing'])]}},
}, open('stubs.json','w'), ensure_ascii=False)
print('заглушки готовы')

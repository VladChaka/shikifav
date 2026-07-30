import json, urllib.request

def gql(q):
    req = urllib.request.Request('https://shikimori.io/api/graphql',
        data=json.dumps({'query': q}).encode(),
        headers={'Content-Type': 'application/json', 'User-Agent': 'ShikiFav'})
    return json.load(urllib.request.urlopen(req, timeout=20))['data']['animes']

search = gql('{animes(search:"kimetsu", limit:6, order:popularity){id name russian kind score status episodes episodesAired airedOn{year} poster{miniUrl mini2xUrl} url}}')
ongoing = gql('{animes(status:"ongoing", limit:12, order:popularity){id name russian episodes episodesAired nextEpisodeAt poster{miniUrl mini2xUrl} url}}')
popular = gql('{animes(limit:12, order:popularity){id name russian episodes poster{miniUrl mini2xUrl} url}}')
json.dump({'search': search, 'ongoing': ongoing, 'popular': popular}, open('demo-data.json','w'), ensure_ascii=False)
print('search:', len(search), '| ongoing:', len(ongoing), '| popular:', len(popular))
print('пример постера:', search[0]['poster']['miniUrl'] if search[0]['poster'] else None)
print('с датой серии:', sum(1 for a in ongoing if a['nextEpisodeAt']), 'из', len(ongoing))

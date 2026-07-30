import base64, json, os, shutil, subprocess, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ws import WS

OUT = os.path.dirname(os.path.abspath(__file__))
EXT = '/home/administrator/IdeaProjects/shikifav/.output/chrome-mv3'
PROFILE = '/tmp/shikifav-shots-profile'
PORT = 9336
STUBS = json.load(open(f'{OUT}/stubs.json'))

class CDP:
    """Синхронные вызовы + насос событий: подмена ответов API требует отвечать
    на Fetch.requestPaused, а он приходит асинхронно."""
    def __init__(self, url):
        self.ws, self.n, self.handlers = WS(url), 0, {}
    def on(self, event, fn): self.handlers[event] = fn
    def _dispatch(self, msg):
        fn = self.handlers.get(msg.get('method'))
        if fn: fn(msg.get('params', {}), msg.get('sessionId'))
    def post(self, method, params=None, sid=None):
        """Отправить без ожидания ответа. Нужно обработчикам событий: вызов
        call() изнутри насоса рассинхронизировал бы сопоставление по id."""
        self.n += 1
        m = {'id': self.n, 'method': method, 'params': params or {}}
        if sid: m['sessionId'] = sid
        self.ws.send(json.dumps(m))

    def call(self, method, params=None, sid=None):
        self.n += 1
        m = {'id': self.n, 'method': method, 'params': params or {}}
        if sid: m['sessionId'] = sid
        self.ws.send(json.dumps(m))
        while True:
            r = json.loads(self.ws.recv())
            if r.get('id') == self.n:
                if 'error' in r: raise RuntimeError(f"{method}: {r['error']}")
                return r.get('result', {})
            self._dispatch(r)
    def pump(self, seconds):
        end = time.time() + seconds
        self.ws.s.settimeout(0.4)
        try:
            while time.time() < end:
                try: self._dispatch(json.loads(self.ws.recv()))
                except Exception: pass
        finally:
            self.ws.s.settimeout(60)

shutil.rmtree(PROFILE, ignore_errors=True)
proc = subprocess.Popen(['/usr/bin/google-chrome', '--headless=new', f'--remote-debugging-port={PORT}',
    f'--user-data-dir={PROFILE}', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--enable-unsafe-extension-debugging', '--remote-allow-origins=*', 'about:blank'],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
info = None
for _ in range(60):
    try:
        info = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json/version', timeout=1)); break
    except Exception: time.sleep(0.5)
if not info: proc.terminate(); raise SystemExit('chrome не поднялся')

c = CDP(info['webSocketDebuggerUrl'])
served = []

def on_paused(params, sid):
    rid, url, body = params['requestId'], params['request'].get('url', ''), params['request'].get('postData') or ''
    op = next((k for k in STUBS if k in body), None)
    if '/api/graphql' in url and op:
        served.append(op)
        c.post('Fetch.fulfillRequest', {'requestId': rid, 'responseCode': 200,
            'responseHeaders': [{'name': 'Content-Type', 'value': 'application/json'}],
            'body': base64.b64encode(json.dumps(STUBS[op]).encode()).decode()}, sid)
    else:
        c.post('Fetch.continueRequest', {'requestId': rid}, sid)
c.on('Fetch.requestPaused', on_paused)

worker_sids = {}

def ensure_worker_fetch(ext_id):
    """Service worker может быть убит между кадрами — перед каждым кадром
    находим его заново и включаем перехват, если ещё не включён."""
    for t in c.call('Target.getTargets')['targetInfos']:
        if t['type'] in ('service_worker', 'worker') and ext_id in t.get('url', ''):
            if t['targetId'] in worker_sids:
                return worker_sids[t['targetId']]
            s = c.call('Target.attachToTarget', {'targetId': t['targetId'], 'flatten': True})['sessionId']
            c.call('Fetch.enable', {'patterns': [{'urlPattern': '*shikimori*'}]}, s)
            worker_sids[t['targetId']] = s
            return s
    return None

try:
    ext_id = c.call('Extensions.loadUnpacked', {'path': EXT})['id']
    print('extension id:', ext_id)
    # Разбудить SW, чтобы цель появилась в списке до первого кадра.
    warm = c.call('Target.createTarget', {'url': f'chrome-extension://{ext_id}/popup.html'})
    c.pump(2.5)
    print('worker session:', 'есть' if ensure_worker_fetch(ext_id) else 'НЕ НАЙДЕН')
    c.call('Target.closeTarget', {'targetId': warm['targetId']})
    seed = json.load(open(f'{OUT}/seed.json'))
    for shot in json.load(open(f'{OUT}/shots.json')):
        t = c.call('Target.createTarget', {'url': f'chrome-extension://{ext_id}/{shot["page"]}'})
        sid = c.call('Target.attachToTarget', {'targetId': t['targetId'], 'flatten': True})['sessionId']
        c.call('Runtime.enable', {}, sid)
        local = dict(seed['local']); local['settings'] = {**local['settings'], **shot.get('settings', {})}
        session = {**seed['session'], **shot.get('session', {})}
        expr = ("(async () => { await chrome.storage.local.clear(); await chrome.storage.session.clear();"
                f" await chrome.storage.local.set({json.dumps(local, ensure_ascii=False)});"
                f" await chrome.storage.session.set({json.dumps(session, ensure_ascii=False)});"
                " return 'ok'; })()")
        # chrome.storage появляется не сразу после createTarget — навигация ещё
        # не закоммичена, контекст пустой. Повторяем, пока API не готов.
        for attempt in range(20):
            r = c.call('Runtime.evaluate', {'expression': expr, 'awaitPromise': True}, sid)
            if r.get('result', {}).get('value') == 'ok': break
            c.pump(0.4)
        else:
            raise RuntimeError(f'seed не лёг: {r}')
        c.call('Page.enable', {}, sid)
        c.call('Emulation.setDeviceMetricsOverride',
               {'width': shot['w'], 'height': shot['h'], 'deviceScaleFactor': 2, 'mobile': False}, sid)
        ensure_worker_fetch(ext_id)
        c.call('Page.reload', {}, sid)
        c.pump(shot.get('wait', 4.0))
        # Ключ раздела ставим ПОСЛЕ загрузки: уже открытая страница ловит его
        # через storage.onChanged и переключается сама, а до reload он был бы
        # съеден первым же экземпляром страницы.
        if shot.get('after_session'):
            c.call('Runtime.evaluate', {'expression':
                f"chrome.storage.session.set({json.dumps(shot['after_session'], ensure_ascii=False)})",
                'awaitPromise': True}, sid)
            c.pump(1.5)
        img = c.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False}, sid)
        open(f'{OUT}/raw-{shot["name"]}.png', 'wb').write(base64.b64decode(img['data']))
        print('снят:', shot['name'], '| подменено:', served[-3:] or '—')
        c.call('Target.closeTarget', {'targetId': t['targetId']})
finally:
    c.ws.close(); proc.terminate()

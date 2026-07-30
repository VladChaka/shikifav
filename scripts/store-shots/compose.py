"""Собирает кадры магазина 1280×800: popup 380×580 меньше требуемого размера,
поэтому он ставится на подложку в цвет темы с подписью."""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1280, 800
OUT = os.path.dirname(os.path.abspath(__file__))

def font(size, bold=False):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf' % ('-Bold' if bold else ''),):
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

SHOTS = [
    ('search',   'Поиск аниме, манги и ранобэ', 'Статус в вашем списке виден сразу, добавление — одним кликом', 'light'),
    ('lists',    'Ваши списки под рукой',       'Прогресс, «+1 эпизод» и оценка — без открытия сайта',           'light'),
    ('calendar', 'Календарь онгоингов',         'Когда выходят следующие серии того, что вы смотрите',           'light'),
    ('lists-dark','Тёмная тема',                'Следует системе или выбирается в настройках',                   'dark'),
]

PAGES = [
    ('options',         'Настройки под себя',   'Стартовая вкладка, статус в один клик, фильтры по умолчанию'),
    ('options-support', 'Раздел «Поддержать»',  'Только ссылки наружу: расширение не собирает данные'),
]

def bg(theme):
    return (28, 26, 24) if theme == 'dark' else (245, 246, 247)
def fg(theme):
    return (233, 230, 226) if theme == 'dark' else (31, 35, 40)
def muted(theme):
    return (164, 155, 147) if theme == 'dark' else (87, 96, 106)

def frame(name, title, sub, theme):
    shot = Image.open(f'{OUT}/raw-{name}.png')
    canvas = Image.new('RGB', (W, H), bg(theme))
    d = ImageDraw.Draw(canvas)
    # popup снят в 2x при 380×580; на подложке 1280×800 логический размер
    # выглядит мелко, поэтому тянем почти на всю высоту кадра — исходник
    # retina, апскейла нет.
    target_h = 700
    scale = target_h / (shot.height // 2)
    popup = shot.resize((int(shot.width // 2 * scale), target_h), Image.LANCZOS)
    x, y = W - popup.width - 80, (H - popup.height) // 2
    d.rectangle([x - 1, y - 1, x + popup.width, y + popup.height],
                outline=(208, 215, 222) if theme == 'light' else (56, 52, 48))
    canvas.paste(popup, (x, y))
    # Текстовый блок: колонка от 80px до края popup, перенос по фактической
    # ширине глифов, весь блок центрируется по вертикали — иначе заголовок
    # налезает на скриншот.
    col = x - 80 - 40
    f_title, f_sub = font(40, True), font(24)
    t_lines = wrap_px(d, title, f_title, col)
    s_lines = wrap_px(d, sub, f_sub, col)
    block = len(t_lines) * 52 + 18 + len(s_lines) * 36
    ty = (H - block) // 2
    for i, line in enumerate(t_lines):
        d.text((80, ty + i * 52), line, font=f_title, fill=fg(theme))
    sy = ty + len(t_lines) * 52 + 18
    for i, line in enumerate(s_lines):
        d.text((80, sy + i * 36), line, font=f_sub, fill=muted(theme))
    return canvas

def wrap_px(draw, text, f, max_px):
    """Перенос по реальной ширине текста, а не по числу символов: кириллица в
    заголовке шире, и счёт символов даёт налезание на скриншот."""
    lines, cur = [], ''
    for w in text.split():
        probe = (cur + ' ' + w).strip()
        if draw.textlength(probe, font=f) <= max_px or not cur: cur = probe
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def wrap(text, n):
    words, lines, cur = text.split(), [], ''
    for w in words:
        if len(cur) + len(w) + 1 <= n: cur = (cur + ' ' + w).strip()
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def page(name, title, sub):
    shot = Image.open(f'{OUT}/raw-{name}.png')
    canvas = Image.new('RGB', (W, H), bg('light'))
    d = ImageDraw.Draw(canvas)
    scale = min((W - 120) / (shot.width // 2), (H - 250) / (shot.height // 2))
    w, h = int(shot.width // 2 * scale), int(shot.height // 2 * scale)
    img = shot.resize((w, h), Image.LANCZOS)
    x, y = (W - w) // 2, 200
    d.rectangle([x - 1, y - 1, x + w, y + h], outline=(208, 215, 222))
    canvas.paste(img, (x, y))
    d.text((x, 90), title, font=font(40, True), fill=fg('light'))
    d.text((x, 146), sub, font=font(24), fill=muted('light'))
    return canvas

n = 0
for args in SHOTS:
    n += 1
    frame(*args).save(f'{OUT}/store-{n}-{args[0]}.png')
for args in PAGES:
    n += 1
    page(*args).save(f'{OUT}/store-{n}-{args[0]}.png')
print(f'готово: {n} кадров 1280×800')

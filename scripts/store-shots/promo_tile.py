#!/usr/bin/env python3
"""Renders the 440x280 promo tile the Chrome Web Store shows on the homepage,
on category pages and in search results.

Kept next to the screenshot scripts for the same reason they exist: a store
asset that cannot be rebuilt from the repository rots the moment the brand
colour or the icon changes.

The tile carries the monogram and the name and nothing else. Google's listing
guide asks for "simple and clean"; at the size the tile is actually shown, any
line smaller than the wordmark turns into noise.

    python3 scripts/store-shots/promo_tile.py

Writes store-assets/promo/promo-tile-440x280.png as a 24-bit PNG without an
alpha channel — the console rejects anything else.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
ICON = ROOT / 'public' / 'icon' / '128.png'
OUT = ROOT / 'store-assets' / 'promo' / 'promo-tile-440x280.png'
FONT = Path('/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf')

SIZE = (440, 280)
# --color-accent of the light theme (src/styles/foundation.scss). The tile sits
# on the store's white page, so it takes the light-theme value, not the dark one.
ACCENT = '#1a7f5a'
FOREGROUND = (255, 255, 255)

MONOGRAM_PX = 92
GAP_PX = 26
WORDMARK_PX = 54


def main() -> None:
    tile = Image.new('RGB', SIZE, ACCENT)

    # public/icon/128.png is opaque RGB: a black monogram on white, no alpha to
    # paste through. The shape therefore comes from inverted luminance — dark
    # glyph becomes an opaque mask, white background becomes nothing — which
    # keeps the anti-aliased edges instead of thresholding them away.
    shape = ImageOps.invert(Image.open(ICON).convert('L')).resize(
        (MONOGRAM_PX, MONOGRAM_PX), Image.LANCZOS
    )
    monogram = Image.new('RGB', shape.size, FOREGROUND)

    font = ImageFont.truetype(str(FONT), WORDMARK_PX)
    draw = ImageDraw.Draw(tile)
    left, top, right, bottom = draw.textbbox((0, 0), 'ShikiFav', font=font)
    text_w, text_h = right - left, bottom - top

    group_w = MONOGRAM_PX + GAP_PX + text_w
    x = (SIZE[0] - group_w) // 2
    tile.paste(monogram, (x, (SIZE[1] - MONOGRAM_PX) // 2), shape)
    draw.text(
        (x + MONOGRAM_PX + GAP_PX - left, (SIZE[1] - text_h) // 2 - top),
        'ShikiFav',
        font=font,
        fill=FOREGROUND,
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    tile.save(OUT, 'PNG')
    print(f'{OUT.relative_to(ROOT)}: {tile.size[0]}x{tile.size[1]}, mode {tile.mode}')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Renders the two promo images of the Chrome Web Store listing.

    440x280   promo tile — homepage, category pages, search results
    1400x560  marquee    — the rotating carousel on the store homepage

Kept next to the screenshot scripts for the same reason they exist: a store
asset that cannot be rebuilt from the repository rots the moment the brand
colour or the icon changes.

Both carry the same lockup, and only the marquee gets a line of text under it:
the tile is shown small, where anything below the wordmark turns into noise,
while the marquee is shown large enough for a sentence to be read.

    python3 scripts/store-shots/promo_images.py

Writes 24-bit PNGs without an alpha channel — the console rejects anything else.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
ICON = ROOT / 'public' / 'icon' / '128.png'
OUT_DIR = ROOT / 'store-assets' / 'promo'
FONT_BOLD = Path('/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf')
FONT_REGULAR = Path('/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf')

# --color-accent of the light theme (src/styles/foundation.scss). The images sit
# on the store's white page, so they take the light-theme value, not the dark one.
ACCENT = (26, 127, 90)
FOREGROUND = (255, 255, 255)
TAGLINE = 'Списки Shikimori в панели браузера'


def _tint(ratio: float) -> tuple[int, int, int]:
    """Blends the foreground towards the background.

    A muted tone has to be mixed by hand: the images ship without an alpha
    channel, so opacity is not available to soften the tagline.
    """
    return tuple(
        round(back + (fore - back) * ratio) for back, fore in zip(ACCENT, FOREGROUND)
    )


def render(
    size: tuple[int, int],
    monogram_px: int,
    wordmark_px: int,
    out: Path,
    tagline_px: int | None = None,
) -> None:
    image = Image.new('RGB', size, ACCENT)
    draw = ImageDraw.Draw(image)

    # public/icon/128.png is opaque RGB: a black monogram on white, no alpha to
    # paste through. The shape therefore comes from inverted luminance — dark
    # glyph becomes an opaque mask, white background becomes nothing — which
    # keeps the anti-aliased edges instead of thresholding them away.
    shape = ImageOps.invert(Image.open(ICON).convert('L')).resize(
        (monogram_px, monogram_px), Image.LANCZOS
    )
    monogram = Image.new('RGB', shape.size, FOREGROUND)

    wordmark_font = ImageFont.truetype(str(FONT_BOLD), wordmark_px)
    w_left, w_top, w_right, w_bottom = draw.textbbox((0, 0), 'ShikiFav', font=wordmark_font)
    wordmark_w, wordmark_h = w_right - w_left, w_bottom - w_top

    gap = round(monogram_px * 0.28)
    lockup_w = monogram_px + gap + wordmark_w
    lockup_h = max(monogram_px, wordmark_h)

    block_h = lockup_h
    tagline_font = None
    tagline_w = tagline_h = t_left = t_top = 0
    tagline_gap = 0
    if tagline_px:
        tagline_font = ImageFont.truetype(str(FONT_REGULAR), tagline_px)
        t_left, t_top, t_right, t_bottom = draw.textbbox((0, 0), TAGLINE, font=tagline_font)
        tagline_w, tagline_h = t_right - t_left, t_bottom - t_top
        tagline_gap = round(tagline_px * 1.1)
        block_h += tagline_gap + tagline_h

    x = (size[0] - lockup_w) // 2
    y = (size[1] - block_h) // 2

    image.paste(monogram, (x, y + (lockup_h - monogram_px) // 2), shape)
    draw.text(
        (x + monogram_px + gap - w_left, y + (lockup_h - wordmark_h) // 2 - w_top),
        'ShikiFav',
        font=wordmark_font,
        fill=FOREGROUND,
    )
    if tagline_font:
        draw.text(
            ((size[0] - tagline_w) // 2 - t_left, y + lockup_h + tagline_gap - t_top),
            TAGLINE,
            font=tagline_font,
            fill=_tint(0.82),
        )

    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, 'PNG')
    print(f'{out.relative_to(ROOT)}: {image.size[0]}x{image.size[1]}, mode {image.mode}')


def main() -> None:
    render((440, 280), 92, 54, OUT_DIR / 'promo-tile-440x280.png')
    render((1400, 560), 260, 150, OUT_DIR / 'promo-marquee-1400x560.png', tagline_px=52)


if __name__ == '__main__':
    main()

#!/usr/bin/env bash
# Rebuild extension icons (public/icon/{16,32,48,128}.png) from the SVG
# sources in assets/icon/.
#
# The mark is the owner's S+F monogram; the owner's own PNGs are archived in
# assets/icon/sf-monogram/ and the vector rebuild lives in assets/icon/*.svg.
#
# Why two sources: scaled straight down, the base drawing puts every horizontal
# edge on a fractional row — at 16 px each bar smears over three rows (one
# black, two grey) and the seam between the S and the F fills in. So 16 and 32
# come from a simplified variant drawn on the 16 px grid (thicker stroke, whole
# pixel bars, 1 px white seams).
#
# Why Chrome: no rsvg/inkscape/ImageMagick on the dev machine. Chrome rasterizes
# the SVG at 4x the target size, Pillow does the LANCZOS downscale (deeper
# blacks and cleaner strokes at 16 px than Chrome's direct 16 px render).
#
# The white sheet is part of the drawing, not transparency: the glyph must stay
# black-on-white on Chrome's dark toolbar. Do not "optimize" it into alpha.
#
# Requirements: google-chrome (override with CHROME=...), python3 with Pillow.
# Usage: scripts/icons.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_BASE="$ROOT/assets/icon/icon.svg"       # 48, 128
SRC_SMALL="$ROOT/assets/icon/icon-small.svg" # 16, 32
OUT_DIR="$ROOT/public/icon"
SUPERSAMPLE=4

CHROME="${CHROME:-/usr/bin/google-chrome}"
command -v "$CHROME" >/dev/null 2>&1 || { echo "chrome not found: $CHROME" >&2; exit 1; }
python3 -c 'import PIL' 2>/dev/null || { echo "python3 with Pillow required" >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

render() { # <svg> <target size>
    local src="$1" size="$2" px=$(( $2 * SUPERSAMPLE ))
    {
        printf '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}'
        printf 'svg{display:block;width:%dpx;height:%dpx}</style>' "$px" "$px"
        cat "$src"
    } >"$TMP_DIR/icon.html"

    "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
        --force-device-scale-factor=1 --window-size="$px,$px" \
        --screenshot="$TMP_DIR/$size.png" "file://$TMP_DIR/icon.html" >/dev/null 2>&1

    python3 - "$TMP_DIR/$size.png" "$OUT_DIR/$size.png" "$size" <<'PY'
import sys
from PIL import Image

src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
img = Image.open(src).convert('RGB').resize((size, size), Image.LANCZOS)
img.save(dst, optimize=True)
PY
    echo "  public/icon/$size.png"
}

mkdir -p "$OUT_DIR"
echo "rendering icons ($SUPERSAMPLE x supersample):"
render "$SRC_SMALL" 16
render "$SRC_SMALL" 32
render "$SRC_BASE" 48
render "$SRC_BASE" 128

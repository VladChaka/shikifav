#!/usr/bin/env bash
# Rebuild extension icons (public/icon/{16,32,48,128}.png) from the SVG
# sources in assets/icon/.
#
# STALE as of 2026-07-29: the shipped icons are no longer the シ ink drawing
# this script renders. The owner supplied an S+F monogram (ShikiFav) as ready
# PNGs — they are in public/icon/ and archived in assets/icon/sf-monogram/.
# Running this script right now would silently put the old mark back. It stays
# here because the pipeline itself (Chrome at 4x + Pillow LANCZOS, two sources)
# is what the monogram needs too: once the mark is vectorised, point SRC_BASE
# and SRC_SMALL at the new files and drop this note.
#
# Why two sources: the base drawing loses its ink texture below ~32 px, so the
# designer supplies a simplified variant (thicker stroke, glyph bleeding to the
# canvas edges) used for 16 and 32.
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

#!/usr/bin/env python3
"""Rebuild every desktop icon from the Faida logo (icon-src/logo.png).

    python3 icon-src/build_icons.py          (run from apps/desktop)

Needs: Python 3 with Pillow. The macOS .icns is made by the Tauri CLI (`npx tauri icon`); if that is not installed
the old .icns is left alone.

The logo is a rounded tile on a white canvas. This script finds the tile, makes everything outside it transparent
(with smooth edges), trims the canvas to a small even margin, and scales that one master to every size. Edit
icon-src/logo.png, not the generated files.

What it writes into src-tauri/icons/:
  icon.png, 512x512@2x.png (1024)  512x512.png  128x128@2x.png (256)  128x128.png  32x32.png  icon.ico  icon.icns
The ICO holds ten sizes from 16 to 256 px, each scaled from the master (not from a smaller icon), small ones sharpened.
Its first entry is the 48 px frame on purpose (see ICO_ORDER).
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import io
import struct

from PIL import Image, ImageChops, ImageFilter

HERE = Path(__file__).resolve().parent
ICONS = HERE.parent / 'src-tauri' / 'icons'
MASTER = 1024          # master edge, px
MARGIN = 0.03          # transparent margin around the tile, as a share of the master
WORK = 4               # supersample factor used while cutting out the tile (smooth edges)
ICO_SIZES = (256, 128, 96, 64, 48, 40, 32, 24, 20, 16)
# Tauri builds the RUNNING window's title-bar and taskbar icon from the FIRST entry of icon.ico and lets Windows rescale it.
# A 16 px first entry gets blown up for the taskbar (blurry); 48 px is scaled down 3:1 for the title bar and 2:1 for the
# 24 px taskbar, so it stays crisp. The order below is therefore deliberate: do not sort it by size.
ICO_ORDER = (48, 256, 128, 96, 64, 40, 32, 24, 20, 16)
SMALL_BELOW = 65       # frames up to this edge are cut from the zoomed 'small' master (see small_master)
SMALL_CROP = 0.845     # share of the tile kept for the small master: crops the empty gradient margin so the shield fills the icon
SMALL_RADIUS = 0.22    # corner radius of the small master, as a share of its edge
SHARPEN_BELOW = 65     # frames up to this edge get an unsharp mask after scaling (fine detail survives shrinking)


def cut_out_tile(src: Image.Image) -> Image.Image:
    """Transparent background, tile only. Flood-fills the white canvas from the corners so white INSIDE the logo stays."""
    big = src.convert('RGB').resize((src.width * WORK // 2, src.height * WORK // 2), Image.LANCZOS)
    w, h = big.size
    # background candidates: pixels whose red, green AND blue are all near white (a pale yellow edge is not)
    r, g, b = big.split()
    lightest_low = ImageChops.darker(ImageChops.darker(r, g), b)
    mask = lightest_low.point(lambda v: 255 if v >= 236 else 0)
    # flood from the four corners: only the white OUTSIDE the tile is reached, white inside the logo stays
    from PIL import ImageDraw
    work = mask.copy()
    for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        ImageDraw.floodfill(work, corner, 128, thresh=0)
    background = work.point(lambda v: 255 if v == 128 else 0)
    # a one-pixel (supersampled) bite and a soft edge hide the white fringe left by anti-aliasing
    tile = ImageChops.invert(background).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = big.convert('RGBA')
    out.putalpha(tile)
    return out


def square_master(tile: Image.Image) -> Image.Image:
    bbox = tile.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bbox:
        sys.exit('could not find the logo tile in icon-src/logo.png')
    tile = tile.crop(bbox)
    side = max(tile.size)
    inner = round(MASTER * (1 - 2 * MARGIN))
    tile = tile.resize((round(tile.width * inner / side), round(tile.height * inner / side)), Image.LANCZOS)
    canvas = Image.new('RGBA', (MASTER, MASTER), (0, 0, 0, 0))
    canvas.paste(tile, ((MASTER - tile.width) // 2, (MASTER - tile.height) // 2), tile)
    return canvas


def small_master(master: Image.Image) -> Image.Image:
    """The same artwork zoomed in on the shield. At 16-64 px the full logo is mush: a quarter of the icon is empty
    gradient. Cropping it makes the shield about 90% of the edge, so its strokes get more pixels. Corners are re-rounded."""
    from PIL import ImageDraw
    box = master.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    side = round((box[2] - box[0]) * SMALL_CROP)
    cx, cy = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
    crop = master.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side))
    big = crop.resize((side * 2, side * 2), Image.LANCZOS)
    mask = Image.new('L', big.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big.width - 1, big.height - 1), radius=round(big.width * SMALL_RADIUS), fill=255)
    big.putalpha(ImageChops.multiply(big.getchannel('A'), mask))
    return big.resize((MASTER, MASTER), Image.LANCZOS)


def scaled(master: Image.Image, size: int) -> Image.Image:
    if size < SMALL_BELOW:
        master = small_master(master)
    out = master.resize((size, size), Image.LANCZOS, reducing_gap=3.0)
    if size < SHARPEN_BELOW:
        # sharpen the colour only; the alpha edge stays as smooth as it was
        rgb = out.convert('RGB').filter(ImageFilter.UnsharpMask(radius=0.6, percent=110 if size > 24 else 140, threshold=0))
        out = Image.merge('RGBA', (*rgb.split(), out.getchannel('A')))
    return out


def write_ico(path: Path, frames: "dict[int, Image.Image]") -> None:
    """Write an ICO with PNG-coded frames in ICO_ORDER (Pillow sorts by size, which is the order we must avoid)."""
    blobs = []
    for size in ICO_ORDER:
        buf = io.BytesIO()
        frames[size].save(buf, format='PNG')
        blobs.append((size, buf.getvalue()))
    out = bytearray(struct.pack('<HHH', 0, 1, len(blobs)))
    offset = 6 + 16 * len(blobs)
    for size, data in blobs:
        out += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    for _, data in blobs:
        out += data
    path.write_bytes(bytes(out))


def main() -> None:
    src = Image.open(HERE / 'logo.png')
    if min(src.size) < 1024:
        print(f'warning: logo.png is {src.width}x{src.height}; 1024 px or more keeps the big icons sharp')
    master = square_master(cut_out_tile(src))
    ICONS.mkdir(parents=True, exist_ok=True)

    master.save(ICONS / 'icon.png')
    master.save(ICONS / '512x512@2x.png')
    scaled(master, 512).save(ICONS / '512x512.png')
    scaled(master, 256).save(ICONS / '128x128@2x.png')
    scaled(master, 128).save(ICONS / '128x128.png')
    scaled(master, 32).save(ICONS / '32x32.png')

    write_ico(ICONS / 'icon.ico', {s: scaled(master, s) for s in ICO_SIZES})

    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp) / 'tauri-icons'
        try:
            subprocess.run(['npx', '--no-install', 'tauri', 'icon', str(ICONS / 'icon.png'), '-o', str(out_dir)],
                           cwd=HERE.parent, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=300, shell=(sys.platform == 'win32'))
            shutil.copyfile(out_dir / 'icon.icns', ICONS / 'icon.icns')
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            print('note: Tauri CLI not available, icon.icns not regenerated')
    print('icons written to', ICONS)


if __name__ == '__main__':
    main()

"""Render the Vocab Strike favicon into a multi-size desktop .ico.

Run with Pillow importable (PYTHONPATH points at a temp install):
    PYTHONPATH=%TEMP%\\pil-lib python make_icon.py

Design: dark rounded square, indigo top glow (brand #6366f1), the cyan dart
from index.html's inline favicon (#22d3ee) with motion streaks behind it.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_ICO = os.path.join(HERE, 'vocab-strike.ico')
OUT_PNG = os.path.join(HERE, 'preview.png')

S = 1024                      # supersample canvas
RADIUS = 0.21                 # corner radius as a fraction of size
CYAN = (34, 211, 238)
BRAND = (99, 102, 241)


def dart_points(scale, ox=0.0, oy=0.0):
    """The favicon's dart (viewBox path M7 16h9l-3-5h5l6 5-6 5h-5l3-5z),
    minus the degenerate tail segment that renders as a stray hairline."""
    pts = [(13, 11), (18, 11), (24, 16), (18, 21), (13, 21), (16, 16)]
    return [(ox + x * scale, oy + y * scale) for x, y in pts]


def build():
    # --- background: vertical gradient, indigo-tinted at the top ---
    grad = Image.linear_gradient('L').resize((S, S))          # 0 at top
    bg = Image.new('RGB', (S, S))
    top, bot = (23, 23, 51), (7, 7, 15)
    bg.paste(Image.new('RGB', (S, S), top), (0, 0))
    bg = Image.composite(Image.new('RGB', (S, S), bot), bg, grad)

    # soft brand glow in the upper-left
    glow = Image.new('L', (S, S), 0)
    ImageDraw.Draw(glow).ellipse([-S * .45, -S * .5, S * .75, S * .55], fill=64)
    glow = glow.filter(ImageFilter.GaussianBlur(S // 7))
    bg = Image.composite(Image.new('RGB', (S, S), BRAND), bg, glow)

    # --- motion streaks behind the dart ---
    streaks = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(streaks)
    scale = S / 32
    for y, x0, w, a in ((11.2, 2.0, 6.5, 150), (16.0, 0.6, 7.5, 210), (20.8, 2.6, 5.5, 130)):
        x1 = x0 + w
        d.rounded_rectangle([x0 * scale, (y - .45) * scale, x1 * scale, (y + .45) * scale],
                            radius=scale * .45, fill=(*BRAND, a))
    streaks = streaks.filter(ImageFilter.GaussianBlur(S / 190))
    bg = Image.alpha_composite(bg.convert('RGBA'), streaks)

    # --- the dart: glow pass, then crisp pass ---
    poly = dart_points(scale, ox=-2.5 * scale, oy=0.0)   # recentre (shape spans x 13..24)
    glow2 = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow2).polygon(poly, fill=(*CYAN, 255))
    glow2 = glow2.filter(ImageFilter.GaussianBlur(S / 34))
    bg = Image.alpha_composite(bg, glow2)

    ImageDraw.Draw(bg).polygon(poly, fill=(*CYAN, 255))

    # --- round the corners, flatten onto transparency ---
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1],
                                           radius=int(S * RADIUS), fill=255)
    icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    icon.paste(bg, (0, 0), mask)

    # --- write preview + multi-size ico ---
    icon.resize((256, 256), Image.LANCZOS).save(OUT_PNG)
    base = icon.resize((256, 256), Image.LANCZOS)
    base.save(OUT_ICO, format='ICO',
              sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('wrote', OUT_ICO, os.path.getsize(OUT_ICO), 'bytes')
    print('wrote', OUT_PNG)


if __name__ == '__main__':
    build()

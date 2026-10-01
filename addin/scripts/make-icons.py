#!/usr/bin/env python3
"""Add-in icons: Tenax navy square, white "card", and the console's signature squiggle in Tenax red.

Rendered per size with 8x supersampling (and a thicker stroke at small sizes so 16px stays legible).
Usage: python3 scripts/make-icons.py   (needs Pillow). Writes public/icon-sig-<size>.png.
"""
from pathlib import Path
from PIL import Image, ImageDraw

NAVY = (14, 32, 64)      # #0E2040, from the Tenax logo
RED = (197, 42, 25)      # #C52A19, from the Tenax logo
WHITE = (255, 255, 255)
SIZES = [16, 32, 64, 80, 128]
OUT = Path(__file__).resolve().parent.parent / "public"

# The console's signature mark, in a 32x32 box: M7 21 c3-1 4-9 7-9 s1 7 4 7 3-4 7-5
SEGMENTS = [
    ((7, 21), (10, 20), (11, 12), (14, 12)),
    ((14, 12), (17, 12), (15, 19), (18, 19)),
    ((18, 19), (21, 19), (21, 15), (25, 14)),
]


def bezier(p0, p1, p2, p3, n=48):
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3
        yield (a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1])


def render(size: int) -> Image.Image:
    s = size * 8
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=round(s * 0.2), fill=NAVY)
    inset = round(s * (0.14 if size <= 16 else 0.17))
    d.rounded_rectangle([inset, inset, s - 1 - inset, s - 1 - inset], radius=round(s * 0.1), fill=WHITE)
    # Map the 32-unit mark (x 7..25, y 12..21) into the card, centred.
    card = s - 2 * inset
    scale = card * 0.78 / 18
    ox = s / 2 - 16 * scale
    oy = s / 2 - 16.5 * scale
    stroke = s * (0.11 if size <= 16 else 0.085 if size <= 32 else 0.07)
    pts = [(ox + x * scale, oy + y * scale) for seg in SEGMENTS for (x, y) in bezier(*seg, n=400)]
    # Stamp round dabs densely along the path: a smooth, evenly thick pen stroke with round ends.
    r = stroke / 2
    for x, y in pts:
        d.ellipse([x - r, y - r, x + r, y + r], fill=RED)
    return im.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for size in SIZES:
        render(size).save(OUT / f"icon-sig-{size}.png", optimize=True)
    print("wrote", ", ".join(f"icon-sig-{n}.png" for n in SIZES))

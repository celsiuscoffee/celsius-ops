# Regenerates the three per-surface hero photos from the A4 artwork.
#
# The A4 crops tight: the glass top sits at y=415 with the baked header rule
# right above it, so no landscape band can hold the whole drink. This extends
# the (already bokeh-blurred) table by stretching and blurring the source to
# plate size, then feathering the real photo back on top, and cuts one window
# per surface at exactly that artboard's photo-box aspect -- so object-fit:
# cover crops nothing and the glass is never clipped.
#
# Needs choc_blanc_a4_300dpi.png (the 2483x3508 print master) in the cwd.

import os
from PIL import Image, ImageFilter

SRC   = "choc_blanc_a4_300dpi.png"
CLEAN = (0, 400, 2483, 2100)      # A4 photo area, below the baked header rule
GLASS = (690, 415, 1720, 1935)    # glass bbox within the A4
PW, PH = 3600, 2700
OX, OY = (PW - (CLEAN[2] - CLEAN[0])) // 2, 520

a4  = Image.open(SRC).convert("RGB")
src = a4.crop(CLEAN)

plate = src.resize((PW, PH), Image.LANCZOS).filter(ImageFilter.GaussianBlur(110))
F = 130
mask = Image.new("L", src.size, 0)
mask.paste(255, (F, F, src.width - F, src.height - F))
mask = mask.filter(ImageFilter.GaussianBlur(F / 2))
plate.paste(src, (OX, OY), mask)

g = (GLASS[0] - CLEAN[0] + OX, GLASS[1] - CLEAN[1] + OY,
     GLASS[2] - CLEAN[0] + OX, GLASS[3] - CLEAN[1] + OY)
gcx = (g[0] + g[2]) // 2

OUT = "/home/user/celsius-ops/docs/design/assets/choc-blanc/canvas"
# name -> (output size, window height, headroom above the glass in window px)
SURFACES = {
    "hero-home.jpg":   ((1200, 800), 2100, 330),
    "hero-splash.jpg": ((1080, 880), 2200, 380),
    "hero-pos.jpg":    ((920, 640),  2200, 380),
}

for name, (out, H, head) in SURFACES.items():
    W  = round(H * out[0] / out[1])
    x0 = gcx - W // 2
    y0 = g[1] - head
    assert 0 <= x0 and x0 + W <= PW, (name, "x", x0, W)
    assert 0 <= y0 and y0 + H <= PH, (name, "y", y0, H)
    assert x0 < g[0] and g[2] < x0 + W, (name, "glass clipped horizontally")
    assert y0 < g[1] and g[3] < y0 + H, (name, "glass clipped vertically")
    im = plate.crop((x0, y0, x0 + W, y0 + H)).resize(out, Image.LANCZOS)
    for q in (80, 74, 68, 62, 56):
        im.save(f"{OUT}/{name}", quality=q, optimize=True, progressive=True)
        if os.path.getsize(f"{OUT}/{name}") <= 72000:
            break
    s = out[1] / H
    print(f"{name:16} out {out[0]}x{out[1]}  q{q} {os.path.getsize(f'{OUT}/{name}')//1024}KB  "
          f"glass renders at y {round((g[1]-y0)*s)}..{round((g[3]-y0)*s)}  "
          f"margins T{round((g[1]-y0)*s)} B{round((y0+H-g[3])*s)} "
          f"L{round((g[0]-x0)*s)} R{round((x0+W-g[2])*s)}")

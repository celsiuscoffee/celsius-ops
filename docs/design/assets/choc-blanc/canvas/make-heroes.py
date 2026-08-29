# Regenerates the three per-surface hero photos from the A4 artwork.
#
# The A4 crops tight: the glass top sits at y=415 with the baked header rule
# right above it, and there is no table below it to put type on. So this
# extends the (already bokeh-blurred) table by stretching and blurring the
# source to plate size, then feathering the real photo back on top.
#
# Each surface gets a FULL-BLEED window at the whole artboard's aspect -- not
# just a photo band -- so the poster reads as one continuous photograph with
# the copy laid over the table, rather than a photo sitting above a flat block
# of colour. The window is sized so the glass occupies roughly the upper half
# and the extended table fills the lower half, which is where the type goes.
#
# Needs choc_blanc_a4_300dpi.png (the 2483x3508 print master) in the cwd.

import os
from PIL import Image, ImageFilter

SRC   = "choc_blanc_a4_300dpi.png"
CLEAN = (0, 400, 2483, 2100)      # A4 photo area, below the baked header rule
GLASS = (690, 415, 1720, 1935)    # glass bbox within the A4
PW, PH = 3600, 3700               # plate: room for a full-bleed window at any aspect
GLASS_TOP = 900                   # where the glass top lands in the plate

a4  = Image.open(SRC).convert("RGB")
src = a4.crop(CLEAN)

OX = (PW - src.width) // 2
OY = GLASS_TOP - (GLASS[1] - CLEAN[1])

plate = src.resize((PW, PH), Image.LANCZOS).filter(ImageFilter.GaussianBlur(120))
F = 130
mask = Image.new("L", src.size, 0)
mask.paste(255, (F, F, src.width - F, src.height - F))
mask = mask.filter(ImageFilter.GaussianBlur(F / 2))
plate.paste(src, (OX, OY), mask)

g = (GLASS[0] - CLEAN[0] + OX, GLASS[1] - CLEAN[1] + OY,
     GLASS[2] - CLEAN[0] + OX, GLASS[3] - CLEAN[1] + OY)
gcx = (g[0] + g[2]) // 2

OUT = os.path.dirname(os.path.abspath(__file__))
# name -> (artboard size, window height, headroom above the glass in window px)
SURFACES = {
    # in-app surfaces
    "hero-home.jpg":   ((1200, 1121), 2900, 430),
    "hero-splash.jpg": ((1080, 2340), 3300, 500),
    "hero-pos.jpg":    ((920, 1200),  3000, 450),
    # social
    "hero-ig-feed.jpg":   ((1080, 1350), 2900, 430),
    "hero-ig-story.jpg":  ((1080, 1920), 3100, 450),
    "hero-ig-square.jpg": ((1080, 1080), 2600, 450),
}

for name, (out, H, head) in SURFACES.items():
    W  = round(H * out[0] / out[1])
    x0, y0 = gcx - W // 2, g[1] - head
    assert 0 <= x0 and x0 + W <= PW, (name, "x", x0, W)
    assert 0 <= y0 and y0 + H <= PH, (name, "y", y0, H)
    assert x0 < g[0] and g[2] < x0 + W, (name, "glass clipped horizontally")
    assert y0 < g[1] and g[3] < y0 + H, (name, "glass clipped vertically")
    im = plate.crop((x0, y0, x0 + W, y0 + H)).resize(out, Image.LANCZOS)
    path = os.path.join(OUT, name)
    for q in (82, 76, 70, 64, 58):
        im.save(path, quality=q, optimize=True, progressive=True)
        if os.path.getsize(path) <= 110000:
            break
    s = out[1] / H
    print(f"{name:16} {out[0]}x{out[1]}  q{q} {os.path.getsize(path)//1024}KB  "
          f"glass y {round((g[1]-y0)*s)}..{round((g[3]-y0)*s)} of {out[1]}  "
          f"clear below glass: {round((y0+H-g[3])*s)}px")


# ── Catalogue product photo ────────────────────────────────────────────────
# products.image_url, NOT a poster: no text, drink centred. The apps crop this
# square in several places (88px menu rows, 140px pairing tiles) while the grid
# card is 4:5, so the square crop of the middle must still hold the whole
# glass -- that is what decides the framing here, not the 4:5 itself.
PROD_H, PROD_OUT = 2150, (1000, 1250)      # 4:5
PW_, PH_ = round(PROD_H * PROD_OUT[0] / PROD_OUT[1]), PROD_H
gcy = (g[1] + g[3]) // 2
x0, y0 = gcx - PW_ // 2, gcy - PH_ // 2
assert 0 <= x0 and x0 + PW_ <= PW and 0 <= y0 and y0 + PH_ <= PH, ("product window", x0, y0)
# the centred square crop the apps will take must still contain the glass
sq_top, sq_bot = y0 + (PH_ - PW_) // 2, y0 + (PH_ - PW_) // 2 + PW_
assert sq_top < g[1] and g[3] < sq_bot, "square crop would cut the glass"

im = plate.crop((x0, y0, x0 + PW_, y0 + PH_)).resize(PROD_OUT, Image.LANCZOS)
path = os.path.join(OUT, "product-choc-blanc.jpg")
for q in (86, 80, 74, 68):
    im.save(path, quality=q, optimize=True, progressive=True)
    if os.path.getsize(path) <= 130000:
        break
sc = PROD_OUT[1] / PH_
print(f"product-choc-blanc.jpg {PROD_OUT[0]}x{PROD_OUT[1]}  q{q} {os.path.getsize(path)//1024}KB  "
      f"glass y {round((g[1]-y0)*sc)}..{round((g[3]-y0)*sc)}  "
      f"square-crop margin {round((g[1]-sq_top)*sc)}px top / {round((sq_bot-g[3])*sc)}px bottom")

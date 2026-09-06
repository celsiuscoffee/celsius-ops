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
CLEAN = (0, 387, 2483, 2100)      # A4 photo area, first row under the baked rule
GLASS = (690, 388, 1720, 1935)    # glass bbox: the cream cap starts at the crop top
TOP_BG = (0, 336, 2483, 378)      # clean backdrop ABOVE the rule -- drink-free, text-free
PW, PH = 3600, 4400               # plate: room for a full-bleed window at any aspect
GLASS_TOP = 900                   # where the glass top lands in the plate

a4  = Image.open(SRC).convert("RGB")
src = a4.crop(CLEAN)

OX = (PW - src.width) // 2
OY = GLASS_TOP - (GLASS[1] - CLEAN[1])

plate = src.resize((PW, PH), Image.LANCZOS).filter(ImageFilter.GaussianBlur(120))


BAND = 24


def _grow(im, pad, top=None, bot_band=BAND):
    """Add pad rows above and below im, stretching a source band into each.

    `top` is the band to stretch upward; without one, im's own top BAND rows.
    """
    w, h = im.size
    top = top or im.crop((0, 0, w, BAND))
    bot = im.crop((0, h - bot_band, w, h))
    # a band stretched ~8x turns its own grain into streaks; blur it back out
    grain = ImageFilter.GaussianBlur(12)
    o = Image.new("RGB", (w, h + 2 * pad))
    o.paste(top.resize((w, pad), Image.LANCZOS).filter(grain), (0, 0))
    o.paste(im, (0, pad))
    o.paste(bot.resize((w, pad), Image.LANCZOS).filter(grain), (0, pad + h))
    return o


def smear(im, pad, top):
    """Grow im by pad on all four sides so the feather never touches the drink.

    The cream cap starts on the crop's FIRST ROW, so a feather inset into the
    photo lands ON THE DRINK -- it was blending the cap 96% into the blurred
    plate. Feathering a smeared margin instead keeps the ramp off the photo.

    Nothing inside the crop is drink-free above the glass, so the top margin
    comes from `top` -- the backdrop above the A4's baked rule. Stretching the
    photo's own top rows there would smear the cap upward into vertical streaks.
    """
    v = _grow(im, pad, top).transpose(Image.ROTATE_90)
    return _grow(v, pad).transpose(Image.ROTATE_270)


PAD = 320                          # must exceed F so the ramp stays off the glass
F = 130
ext = smear(src, PAD, a4.crop(TOP_BG))
mask = Image.new("L", ext.size, 0)
mask.paste(255, (F, F, ext.width - F, ext.height - F))
mask = mask.filter(ImageFilter.GaussianBlur(F / 2))
# guard: the real photo must be FULLY opaque across the whole drink, margin
# included -- a partly-transparent glass is a glass blended into the blur.
_gx0, _gy0 = GLASS[0] - CLEAN[0] + PAD, GLASS[1] - CLEAN[1] + PAD
_gx1, _gy1 = GLASS[2] - CLEAN[0] + PAD, GLASS[3] - CLEAN[1] + PAD
_m = mask.crop((_gx0 - 24, _gy0 - 24, _gx1 + 24, _gy1 + 24)).getextrema()[0]
assert _m == 255, f"feather reaches the drink (min alpha {_m}/255)"
assert TOP_BG[3] <= CLEAN[1], "top backdrop band overlaps the photo crop"

plate.paste(ext, (OX - PAD, OY - PAD), mask)

g = (GLASS[0] - CLEAN[0] + OX, GLASS[1] - CLEAN[1] + OY,
     GLASS[2] - CLEAN[0] + OX, GLASS[3] - CLEAN[1] + OY)
gcx = (g[0] + g[2]) // 2

OUT = os.path.dirname(os.path.abspath(__file__))
# name -> (artboard size, window height, headroom above the glass in window px)
# The home carousel follows the house poster layout: copy sits mid-left over the
# photo, so the glass has to sit RIGHT of centre rather than dead centre. A
# shorter window leaves horizontal slack in the plate to push it across; x_bias
# 0.0 means "window hard against the left of the plate", which puts the glass as
# far right as the plate allows (~61% across).
SURFACES = {
    # in-app surfaces
    "hero-home.jpg":   ((1200, 1121), 2500, 490, 0.0),
    "hero-splash.jpg": ((1080, 2340), 4200, 900),
    "hero-pos.jpg":    ((920, 1200),  3000, 450),
    # social
    "hero-ig-feed.jpg":   ((1080, 1350), 2900, 430),
    "hero-ig-story.jpg":  ((1080, 1920), 3100, 450),
    "hero-ig-square.jpg": ((1080, 1080), 2600, 450),
}

for name, spec in SURFACES.items():
    out, H, head = spec[0], spec[1], spec[2]
    x_bias = spec[3] if len(spec) > 3 else None   # None = centre the glass
    W  = round(H * out[0] / out[1])
    x0 = gcx - W // 2 if x_bias is None else round(x_bias * (PW - W))
    y0 = g[1] - head
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

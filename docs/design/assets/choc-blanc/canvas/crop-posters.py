# Crops each raw render to its artboard box and fails loudly if the crop still
# shows page background on the bottom/right edge -- that means the layout
# viewport was smaller than the artboard and copy has been cut off.
import json, os, sys
from PIL import Image

out, artboards = sys.argv[1], json.loads(sys.argv[2])
PAGE_BG = (0x0F, 0x05, 0x00)   # body background, never part of an artboard

for a in artboards:
    w, h, name = a["w"], a["h"], a["name"]
    raw = os.path.join(out, f"{name}-raw.png")
    im = Image.open(raw).convert("RGB")
    if im.width < w or im.height < h:
        sys.exit(f"{name}: render {im.size} smaller than artboard {(w, h)}")
    crop = im.crop((0, 0, w, h))

    edge = ([crop.getpixel((x, h - 1)) for x in range(0, w, 5)] +
            [crop.getpixel((w - 1, y)) for y in range(0, h, 5)])
    if any(c == PAGE_BG for c in edge):
        sys.exit(f"{name}: page background on the bottom/right edge -- artboard was clipped")

    png = os.path.join(out, f"{name}-{w}x{h}.png")
    jpg = os.path.join(out, f"{name}-{w}x{h}.jpg")
    crop.save(png)
    crop.save(jpg, quality=92, optimize=True, progressive=True, subsampling=0)
    os.remove(raw)
    print(f"  {name}-{w}x{h}  png {os.path.getsize(png)//1024}KB  jpg {os.path.getsize(jpg)//1024}KB")

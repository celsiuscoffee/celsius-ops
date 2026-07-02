# Celsius Ops — notes for Claude

## Brand (CC Brand System v2026)

The ºC brand mark is a hand-drawn serif glyph with a small hollow degree ring.
**Never synthesize the logo by typesetting "°C" in a system/sans font** — a
generic-font version shipped in the staff app's PWA icons once and had to be
replaced. Always compose icons from the designer assets already in the repo:

- White mark on brand black (512px): `apps/pickup-native/public/icons/icon-512.png`
- Black mark on white (512px): `apps/staff/public/images/icon.png`, `apps/backoffice/public/images/icon.png`
- White mark on terracotta (192px): `apps/staff/public/images/celsius-logo-sm.jpg`

Colours:

- UI terracotta (buttons/accents): `#C2452D` (see `apps/staff/src/app/globals.css`)
- Icon/theme terracotta (logo backgrounds, PWA `theme_color`): `#B85C38`
- Brand black (terracotta-tinged): `#160800` / `#1A0200`
- Off-white: `#F5F3F0`

Typography: Peachi (display), Space Grotesk (body).

Authoritative reference: `CC_BRAND SYSTEM (v2026).pdf` in the Google Drive
folder `00 BRAND SYSTEM` (owner: design.studiohdj@gmail.com).

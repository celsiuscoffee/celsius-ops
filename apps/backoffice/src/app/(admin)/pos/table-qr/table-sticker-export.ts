/**
 * Client-side PNG export for the "Scan & Order" table stickers, bundled into a
 * single ZIP to hand the print company. Dependency-free:
 *   • Canvas 2D renderer — draws the full print-production sticker (full-bleed
 *     espresso + crop marks + magenta die-cut line + spec caption) at 300 DPI.
 *     Pixel-faithful port of print_stickers.py / the StickerPage component, so
 *     all three stay in sync (1080×2160 design space, scaled by S).
 *   • Store-only ZIP writer (PNGs are already compressed → no deflate needed).
 *
 * Keep drawSticker() in sync with StickerPage in page.tsx if the design changes.
 */
import QRCode from "qrcode";

const BG = "#15090A", CREAM = "#F5F1EA", MUTE = "#96867E", GOLD = "#D2965C", INK = "#160800";
const CREAM_RGB = "245,241,234";
const NOTE =
  "A NOTE FROM OUR TABLE TO YOURS — THIS SPACE IS MADE TO BE SHARED. SOLO? GRAB ONE " +
  "OF THE SMALLER TABLES. STAYING A WHILE? KEEP IT WARM WITH A DRINK (OR DRINKSSS) AND " +
  "A BITE — OURS IS MADE TO BE CRAVED & DROOLED OVER. GLAD YOU'RE HERE.";

const USERS_PATHS = [
  "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
  "M22 21v-2a4 4 0 0 0-3-3.87",
  "M16 3.13a4 4 0 0 1 0 7.75",
]; // + circle(9,7,4)
const SANDWICH_PATHS = [
  "M3 11v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3",
  "M12 19H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-3.83",
  "m3 11 7.77-6.04a2 2 0 0 1 2.46 0L21 11H3Z",
  "M12.97 19.77 7 15h12.5l-3.75 2.81a2.13 2.13 0 0 1-2.78-.04Z",
];

export const tableTitle = (label: string) =>
  /^\d+$/.test(label) ? `TABLE ${label.padStart(2, "0")}` : `TABLE ${label}`;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/** The next/font family is a hashed name exposed via the CSS var, not "Space Grotesk". */
function brandFontFamily(): string {
  if (typeof window === "undefined") return "sans-serif";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-space-grotesk").trim();
  return v || "'Space Grotesk', sans-serif";
}

export type StickerOpts = {
  url: string; label: string; seats: number | null; outletLine: string; foot: string;
  stickerWcm: number; // finished width in cm (height auto = 2×)
  marks?: boolean;    // default true = production (bleed + crop marks + die-cut + caption);
                      // false = design only at the actual finished size, no marks/wording
};

type Assets = { degc: HTMLImageElement; qr: HTMLImageElement; fam: string };

function strokeIcon(ctx: CanvasRenderingContext2D, paths: string[], circle: boolean, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = CREAM; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const d of paths) ctx.stroke(new Path2D(d));
  if (circle) { ctx.beginPath(); ctx.arc(9, 7, 4, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}

/** Draw the card artwork (espresso-filled) at (ox,oy) in trim space. */
function drawCard(ctx: CanvasRenderingContext2D, ox: number, oy: number, trimW: number, P: (v: number) => number, opts: StickerOpts, a: Assets) {
  const fam = a.fam;
  const font = (w: number, px: number) => { ctx.font = `${w} ${px}px ${fam}`; };
  ctx.fillStyle = BG; ctx.fillRect(ox, oy, trimW, trimW * 2);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.textBaseline = "top"; ctx.textAlign = "left";

  // °C mark (top-right)
  const mh = P(116), mw = Math.round((a.degc.width * mh) / a.degc.height);
  ctx.drawImage(a.degc, trimW - P(92) - mw, P(104), mw, mh);

  // gold accent + eyebrow
  ctx.fillStyle = GOLD; ctx.fillRect(P(92), P(250), P(130), P(7));
  ctx.fillStyle = CREAM; font(700, P(44)); ctx.letterSpacing = `${P(5)}px`;
  ctx.fillText("SCAN & ORDER", P(92), P(286));
  ctx.letterSpacing = "0px";

  // headline
  font(500, P(86));
  ["SCAN QR", "CHOOSE ITEMS", "PAY ONLINE"].forEach((ln, i) => ctx.fillText(ln, P(92), P(420) + i * P(112)));

  // QR panel
  const pw = P(624), ph = P(792), px = P(92), py = P(786);
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(px, py, pw, ph, P(26)); ctx.fill();
  const qs = P(470);
  ctx.drawImage(a.qr, px + Math.round((pw - qs) / 2), py + P(78), qs, qs);
  ctx.fillStyle = INK; font(500, P(58)); ctx.fillText(tableTitle(opts.label), px + P(52), py + ph - P(130));

  // vertical outlet line (reads bottom-to-top, right side)
  ctx.save();
  font(600, P(30)); ctx.fillStyle = CREAM; ctx.letterSpacing = `${P(3)}px`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.translate(trimW - P(62), py + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(opts.outletLine, 0, 0);
  ctx.restore();
  ctx.letterSpacing = "0px"; ctx.textAlign = "left"; ctx.textBaseline = "top";

  // ACHTUNG! + wrapped note
  const ny0 = P(786) + P(792) + P(116);
  ctx.fillStyle = GOLD; font(700, P(25)); ctx.letterSpacing = `${P(4)}px`;
  ctx.fillText("ACHTUNG!", P(92), ny0);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = MUTE; font(450, P(25));
  let ny = ny0 + P(52); const maxw = trimW - 2 * P(92); let line = "";
  for (const word of NOTE.split(" ")) {
    const t = line ? line + " " + word : word;
    if (ctx.measureText(t).width <= maxw) line = t;
    else { ctx.fillText(line, P(92), ny); ny += P(40); line = word; }
  }
  if (line) ctx.fillText(line, P(92), ny);

  // badges
  const by = P(1964), bhh = P(104), gap = P(26), bwd = Math.floor((trimW - 2 * P(92) - gap) / 2);
  const seat = opts.seats ? `TABLE FOR ${opts.seats}` : "FIND A SEAT";
  const badge = (x: number, paths: string[], circle: boolean, text: string) => {
    ctx.strokeStyle = `rgba(${CREAM_RGB},0.37)`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, by, bwd, bhh, P(16)); ctx.stroke();
    const isz = P(52);
    strokeIcon(ctx, paths, circle, x + P(22), by + (bhh - isz) / 2, isz);
    const dvx = x + P(22) + isz + P(20);
    ctx.strokeStyle = `rgba(${CREAM_RGB},0.22)`; ctx.beginPath();
    ctx.moveTo(dvx, by + P(24)); ctx.lineTo(dvx, by + bhh - P(24)); ctx.stroke();
    ctx.fillStyle = CREAM; font(600, P(26)); ctx.textBaseline = "middle"; ctx.letterSpacing = `${P(1)}px`;
    ctx.fillText(text, dvx + P(20), by + bhh / 2 + P(1));
    ctx.textBaseline = "top"; ctx.letterSpacing = "0px";
  };
  badge(P(92), USERS_PATHS, true, seat);
  badge(P(92) + bwd + gap, SANDWICH_PATHS, false, opts.foot);

  ctx.restore();
}

/** Paints one sticker onto ctx. marks=false → design only at the actual finished
 *  size (no bleed/crop/die-cut/caption); marks=true → full print-production page. */
function drawSticker(ctx: CanvasRenderingContext2D, opts: StickerOpts, a: Assets) {
  const DPI = 300;
  const MM = (mm: number) => Math.round((mm / 25.4) * DPI);
  const trimW = MM(opts.stickerWcm * 10), trimH = MM(opts.stickerWcm * 20);
  const S = trimW / 1080;
  const P = (v: number) => Math.round(v * S);
  const fam = a.fam;
  const font = (w: number, px: number) => { ctx.font = `${w} ${px}px ${fam}`; };

  // Design only — just the artwork at the actual finished size.
  if (opts.marks === false) {
    drawCard(ctx, 0, 0, trimW, P, opts, a);
    return { pageW: trimW, pageH: trimH };
  }

  // Print-production page: bleed + crop marks + die-cut + spec caption.
  const BLEED = MM(3), SLUG = MM(10), SLUG_BOT = MM(22), RAD = MM(8);
  const bw = trimW + 2 * BLEED, bh = trimH + 2 * BLEED;
  const pageW = bw + 2 * SLUG, pageH = bh + SLUG + SLUG_BOT;
  const tx = SLUG + BLEED, ty = SLUG + BLEED; // trim origin on the page

  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, pageW, pageH);
  ctx.fillStyle = BG; ctx.fillRect(SLUG, SLUG, bw, bh); // espresso bleed
  drawCard(ctx, tx, ty, trimW, P, opts, a);

  // crop marks
  ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
  const mk = MM(4);
  const corners: [number, number, number, number][] = [
    [tx, ty, -1, -1], [tx + trimW, ty, 1, -1], [tx, ty + trimH, -1, 1], [tx + trimW, ty + trimH, 1, 1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + sy * BLEED); ctx.lineTo(cx, cy + sy * (BLEED + mk));
    ctx.moveTo(cx + sx * BLEED, cy); ctx.lineTo(cx + sx * (BLEED + mk), cy);
    ctx.stroke();
  }

  // die-cut path (magenta rounded rect on the trim outline)
  ctx.strokeStyle = "#ff00ff"; ctx.lineWidth = Math.max(3, MM(0.4));
  ctx.beginPath(); ctx.roundRect(tx, ty, trimW, trimH, RAD); ctx.stroke();

  // spec caption (bottom slug)
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  const cap = MM(2.4), cy0 = ty + trimH + BLEED + P(40);
  ctx.fillStyle = "#555"; font(600, cap);
  ctx.fillText(`CELSIUS — SCAN & ORDER TABLE STICKER  ·  ${opts.outletLine}  ·  ${tableTitle(opts.label)}`, pageW / 2, cy0);
  ctx.fillStyle = "#888"; font(400, MM(2.1));
  ctx.fillText(`Finished ${opts.stickerWcm} × ${opts.stickerWcm * 2} cm  ·  Bleed 3 mm  ·  Die-cut rounded corners R8 mm  ·  300 DPI`, pageW / 2, cy0 + MM(4.4));
  ctx.fillStyle = "#c07ab0";
  ctx.fillText("Magenta line = die-cut path (non-printing).  Background is full-bleed — trim on crop marks.", pageW / 2, cy0 + MM(8.4));
  ctx.textAlign = "left";

  return { pageW, pageH };
}

/** Render one sticker to a PNG Blob at 300 DPI. */
export async function renderStickerBlob(opts: StickerOpts, degc: HTMLImageElement, fam: string): Promise<Blob> {
  const qrUrl = await QRCode.toDataURL(opts.url, { width: 900, margin: 1, color: { dark: INK, light: "#ffffff" } });
  const qr = await loadImage(qrUrl);
  // size pass: compute page px with a throwaway 1×1 ctx (drawSticker is deterministic)
  const probe = document.createElement("canvas").getContext("2d")!;
  const { pageW, pageH } = drawSticker(probe, opts, { degc, qr, fam });
  const canvas = document.createElement("canvas");
  canvas.width = pageW; canvas.height = pageH;
  const ctx = canvas.getContext("2d")!;
  drawSticker(ctx, opts, { degc, qr, fam });
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}

/** Load shared assets (the °C mark) + ensure brand-font weights are ready. */
export async function prepareStickerAssets(): Promise<{ degc: HTMLImageElement; fam: string }> {
  const fam = brandFontFamily();
  if (typeof document !== "undefined" && "fonts" in document) {
    await Promise.all([700, 600, 500, 450, 400].map((w) => document.fonts.load(`${w} 80px ${fam}`).catch(() => {})));
  }
  const degc = await loadImage("/brand/celsius-degc.png");
  return { degc, fam };
}

// ── Minimal store-only ZIP (no compression; PNGs are already compressed) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0), name,
    ]);
    chunks.push(local, f.data);
    central.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(f.data.length), u32(f.data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length + f.data.length;
  }
  const cd = concat(central);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cd.length), u32(offset), u16(0),
  ]);
  // cast: Uint8Array is a valid BlobPart at runtime (TS 5.7 typed-array generics are over-strict here)
  return new Blob([...chunks, cd, end] as unknown as BlobPart[], { type: "application/zip" });
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

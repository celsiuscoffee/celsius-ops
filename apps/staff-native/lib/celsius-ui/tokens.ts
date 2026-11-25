/* Celsius UI tokens for the manager app (React Native).
 *
 * The same names and values as the back office
 * (apps/backoffice/src/styles/celsius-ui/tokens.css): Gosamē UI token names,
 * Celsius values. Off-white paper and espresso ink, terracotta only for the
 * logo, the active dot and one highlight; red, amber, green and blue each mean
 * one thing and always come with an icon or a word.
 *
 * `celsius-ui.test.ts` fails when a value here drifts from tokens.css, so
 * change the back office file first and copy the value here.
 */

export type Scheme = "light" | "dark";

export const colorNames = [
  "bg", "surface", "raised", "sunken", "line", "line-2", "line-ctl",
  "text", "text-2", "text-3",
  "ink", "on-ink", "ink-hover", "hero", "on-hero", "brand-glow",
  "brand", "on-brand", "brand-soft", "brand-text",
  "danger", "danger-soft", "danger-text",
  "warn", "warn-soft", "warn-text",
  "ok", "ok-soft", "ok-text",
  "info", "info-soft", "info-text",
  "c1", "c2", "c3", "c4", "c5", "c6", "other", "grid",
  "sel", "tab", "scrim",
] as const;

export type ColorName = (typeof colorNames)[number];
export type Palette = Readonly<Record<ColorName, string>>;

export const palette: Readonly<Record<Scheme, Palette>> = {
  light: {
    bg: "#F5F3F0",
    surface: "#FBFAF8",
    raised: "#FFFEFC",
    sunken: "#ECE8E2",
    line: "#E5E0D9",
    "line-2": "#D3CCC2",
    "line-ctl": "#8C8178",
    text: "#160800",
    "text-2": "#5A4E46",
    "text-3": "#6E6259",
    ink: "#160800",
    "on-ink": "#F7F3EE",
    "ink-hover": "#33241B",
    hero: "#160800",
    "on-hero": "#F7F3EE",
    "brand-glow": "#E9A08F",
    brand: "#C2452D",
    "on-brand": "#FFFFFF",
    "brand-soft": "#F6E2DC",
    "brand-text": "#A33822",
    danger: "#B4442A",
    "danger-soft": "#F5DFD6",
    "danger-text": "#9E3A22",
    warn: "#B8862B",
    "warn-soft": "#F3E6C6",
    "warn-text": "#7A5813",
    ok: "#5F7F4E",
    "ok-soft": "#E1E8D5",
    "ok-text": "#46653A",
    info: "#4A688A",
    "info-soft": "#DEE4EA",
    "info-text": "#3B5878",
    c1: "#C2452D",
    c2: "#41629F",
    c3: "#299A8B",
    c4: "#B5841D",
    c5: "#965582",
    c6: "#6C853B",
    other: "#B9AFA4",
    grid: "#E7E2DA",
    sel: "#F7E9E4",
    tab: "#FBFAF8",
    scrim: "rgba(22, 8, 0, 0.45)",
  },
  dark: {
    bg: "#120B08",
    surface: "#1B1411",
    raised: "#251C18",
    sunken: "#0D0806",
    line: "#2E2420",
    "line-2": "#3D312C",
    "line-ctl": "#7A6E66",
    text: "#F3ECE4",
    "text-2": "#C4B8AC",
    "text-3": "#A39689",
    ink: "#F3ECE4",
    "on-ink": "#160800",
    "ink-hover": "#DCD2C6",
    hero: "#2A1E19",
    "on-hero": "#F3ECE4",
    "brand-glow": "#E58A73",
    brand: "#B8452D",
    "on-brand": "#FFFFFF",
    "brand-soft": "#3A1E17",
    "brand-text": "#E58A73",
    danger: "#E07A5F",
    "danger-soft": "#3A221B",
    "danger-text": "#F0A28E",
    warn: "#D9AE55",
    "warn-soft": "#352A17",
    "warn-text": "#E6C27A",
    ok: "#9DBB86",
    "ok-soft": "#232C1D",
    "ok-text": "#B4CC9F",
    info: "#8FAACB",
    "info-soft": "#1E2632",
    "info-text": "#AFC3DB",
    c1: "#E07A62",
    c2: "#5073B5",
    c3: "#36A996",
    c4: "#B78A2C",
    c5: "#A76090",
    c6: "#647C32",
    other: "#5E544D",
    grid: "#2A201B",
    sel: "#2A1C17",
    tab: "#1B1411",
    scrim: "rgba(0, 0, 0, 0.6)",
  },
};

/** Radius, in dp: cards 16, controls 8 (the back office's --r-card / --r-ctl). */
export const radius = { card: 16, ctl: 8, full: 999 } as const;

/** Minimum finger target on a phone (Celsius UI phone rule). */
export const TARGET = 44;

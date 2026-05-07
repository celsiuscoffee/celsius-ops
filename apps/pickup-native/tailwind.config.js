/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Brand-system aligned (CC Brand System v2026 §1.4). The book
        // sanctions four backgrounds: terracotta panels, brand black
        // #1A0200, white, or photo+overlay. Cream isn't in the system
        // and was an off-brand choice — reverted.
        background: "#FFFFFF",   // body bg — clean white per brand book
        surface: "#FFFFFF",
        espresso: "#1A0200",     // BRAND BLACK — terracotta-tinged, earthy
        primary: {
          DEFAULT: "#C05040",    // terracotta — brand primary
          50: "#FBEBE8",
          100: "#F5D2CC",
          900: "#5A1F16",
        },
        muted: {
          DEFAULT: "#6B6B6B",    // neutral grey for secondary text
          fg: "#4A4A4A",
        },
        // Retro touch — hairlines are brand-black at low alpha so
        // every divider carries a hint of brand without screaming.
        border: "rgba(26, 2, 0, 0.10)",
        amber: {
          400: "#FBBF24",
          500: "#F59E0B",
        },
      },
      fontFamily: {
        sans: ["System"],
        display: ["Peachi-Bold"],
        "display-medium": ["Peachi-Medium"],
        "display-regular": ["Peachi-Regular"],
        body: ["SpaceGrotesk_400Regular"],
        "body-medium": ["SpaceGrotesk_500Medium"],
        "body-semi": ["SpaceGrotesk_600SemiBold"],
        "body-bold": ["SpaceGrotesk_700Bold"],
      },
      borderRadius: {
        "4xl": "32px",
      },
    },
  },
  plugins: [],
};

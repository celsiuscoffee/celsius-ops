/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Brand-system aligned: #1A0200 is the safe "Celsius black"
        // (terracotta-tinged, earthy, not bright), terracotta primary
        // #C05040 is the brand's signature warm accent. Body stays
        // soft so the espresso/terracotta tones can breathe.
        background: "#F5F1E8",   // soft cream — sits warm against terracotta
        surface: "#FFFFFF",      // card bg — clean white
        espresso: "#1A0200",     // BRAND BLACK from CC Brand System v2026
        primary: {
          DEFAULT: "#C05040",    // terracotta — brand primary
          50: "#FBEBE8",
          100: "#F5D2CC",
          900: "#5A1F16",
        },
        muted: {
          DEFAULT: "#8B7E72",    // warm earthy grey
          fg: "#6B5E54",         // deeper earthy grey-brown
        },
        // Retro touch — borders are 1.5×-thick terracotta at low alpha
        // rather than cool grey hairlines. Tints every card with brand.
        border: "#D9CFC2",
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

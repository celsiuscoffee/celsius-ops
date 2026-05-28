/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // POS runs on the espresso/dark palette to match the cashier-
        // facing register + customer-display (CC Brand System v2026).
        background: "#160800", // espresso — shared with web POS PAGE_BG
        surface: "#1A0A02",
        espresso: "#160800",
        primary: {
          DEFAULT: "#A2492C", // terracotta — brand CTA
          50: "#F6E8E2",
          100: "#EBD0C2",
          900: "#4E1F12",
        },
        muted: {
          DEFAULT: "#9A8C82",
          fg: "rgba(245,243,240,0.6)",
        },
        cream: "#F5F3F0",
        border: "rgba(245,243,240,0.10)",
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

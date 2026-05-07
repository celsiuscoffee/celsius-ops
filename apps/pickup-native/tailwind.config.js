/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Warm cream palette — Blank Street-inspired. Reads as
        // hand-roasted / specialty rather than tech-grey.
        background: "#F7F2EA",   // body bg — warm cream (was #f5f5f5)
        surface: "#FFFEFB",      // card bg — slightly warmer white
        espresso: "#160800",
        primary: {
          DEFAULT: "#C05040",
          50: "#FBEBE8",
          100: "#F5D2CC",
          900: "#5A1F16",
        },
        muted: {
          DEFAULT: "#8E8A82",    // warm grey (was #8E8E93)
          fg: "#6E6A60",         // warm grey-brown (was #6E6E73)
        },
        border: "#E8E2D6",       // warm hairline (was #E5E5E5)
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

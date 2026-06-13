/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Themeable tokens resolve against CSS vars set by lib/theme.ts
        // at the root. Fallback = the light value, so if the theme
        // wrapper is ever missing the app still renders correctly (light).
        background: "var(--color-background, #FFFFFF)",
        surface: "var(--color-surface, #FFFFFF)",
        espresso: "var(--color-espresso, #1A0200)",
        primary: {
          DEFAULT: "#A2492C", // brand — same in both modes
          50: "var(--color-primary-50, #F6E8E2)",
          100: "var(--color-primary-100, #EBD0C2)",
          900: "#4E1F12",
        },
        muted: {
          DEFAULT: "var(--color-muted, #6B6B6B)",
          fg: "var(--color-muted-fg, #4A4A4A)",
        },
        border: "var(--color-border, rgba(26, 2, 0, 0.10))",
        // Accents read well on both light & dark — kept constant.
        amber: {
          400: "#FBBF24",
          500: "#F59E0B",
        },
        success: "#15803D",
        danger: "#B91C1C",
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

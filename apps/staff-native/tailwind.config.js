/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Themeable neutral / terracotta-tint tokens resolve against the CSS
        // variables applied at the root in app/_layout.tsx (see lib/theme.ts
        // for the light/dark values). Pure brand + accent colors stay static
        // since they read well in both modes.
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        espresso: "var(--color-espresso)",
        primary: {
          DEFAULT: "#A2492C",
          50: "var(--color-primary-50)",
          100: "var(--color-primary-100)",
          900: "#4E1F12",
        },
        muted: {
          DEFAULT: "var(--color-muted)",
          fg: "var(--color-muted-fg)",
        },
        border: "var(--color-border)",
        gray: {
          50: "var(--color-gray-50)",
          100: "var(--color-gray-100)",
          200: "var(--color-gray-200)",
        },
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

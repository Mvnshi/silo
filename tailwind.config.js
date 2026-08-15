/**
 * NativeWind (Tailwind-for-RN) config.
 *
 * KEEP IN SYNC with lib/theme.ts — every scale here mirrors a token export
 * there (`BRAND`/`ACCENT`/`INK`/`STATUS`, `RADIUS`, `SPACE`, `TYPE`). If you
 * add a step in one file, add it in the other or the app drifts into two
 * slightly-different design systems.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Silo brand — violet-forward, premium.
        brand: {
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
          950: "#2e1065",
        },
        accent: {
          400: "#f472b6",
          500: "#ec4899",
          600: "#db2777",
        },
        ink: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
        },
        // Mirrors STATUS in lib/theme.ts.
        danger: { DEFAULT: "#dc2626", soft: "#fef2f2" },
        success: { DEFAULT: "#16a34a", soft: "#f0fdf4" },
        warning: { DEFAULT: "#d97706", soft: "#fffbeb" },
      },
      // Mirrors RADIUS in lib/theme.ts.
      borderRadius: {
        xs: "6px",
        sm: "10px",
        md: "14px",
        lg: "20px",
        xl: "26px",
        "2xl": "32px",
        "4xl": "28px",
        pill: "999px",
      },
      // Mirrors SPACE in lib/theme.ts (Tailwind's numeric scale stays available).
      spacing: {
        xxs: "2px",
        xs: "4px",
        sm: "8px",
        md: "12px",
        base: "16px",
        lg: "20px",
        xl: "24px",
        xxl: "32px",
        xxxl: "40px",
        huge: "48px",
      },
      // Mirrors TYPE in lib/theme.ts — [size, { lineHeight, letterSpacing }].
      fontSize: {
        display: ["34px", { lineHeight: "40px", letterSpacing: "-0.8px" }],
        title1: ["28px", { lineHeight: "34px", letterSpacing: "-0.6px" }],
        title2: ["22px", { lineHeight: "28px", letterSpacing: "-0.4px" }],
        title3: ["19px", { lineHeight: "25px", letterSpacing: "-0.3px" }],
        headline: ["17px", { lineHeight: "23px", letterSpacing: "-0.2px" }],
        body: ["16px", { lineHeight: "23px", letterSpacing: "-0.1px" }],
        callout: ["15px", { lineHeight: "21px", letterSpacing: "-0.1px" }],
        subhead: ["14px", { lineHeight: "20px" }],
        footnote: ["13px", { lineHeight: "18px" }],
        caption: ["12px", { lineHeight: "16px", letterSpacing: "0.1px" }],
        overline: ["11px", { lineHeight: "14px", letterSpacing: "0.6px" }],
      },
    },
  },
  plugins: [],
};

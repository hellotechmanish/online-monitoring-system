import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: v("background"),
        surface: v("surface"),
        muted: v("muted"),
        border: v("border"),
        foreground: v("foreground"),
        subtle: v("subtle"),
        primary: { DEFAULT: v("primary"), foreground: v("primary-foreground") },
        navy: { DEFAULT: v("navy"), light: v("navy-light") },
        success: v("success"),
        warning: v("warning"),
        danger: v("danger"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  corePlugins: {
    preflight: false
  },
  theme: {
    colors: {
      bg: "var(--bg)",
      surface: "var(--surface)",
      "surface-muted": "var(--surface-muted)",
      border: "var(--border)",
      text: "var(--text)",
      "text-muted": "var(--text-muted)",
      "text-subtle": "var(--text-subtle)",
      accent: "var(--accent)",
      "accent-foreground": "var(--accent-foreground)",
      danger: "var(--danger)",
      highlight: "var(--highlight)"
    },
    spacing: {
      1: "4px",
      2: "8px",
      3: "12px",
      4: "16px",
      6: "24px",
      8: "32px",
      12: "48px"
    },
    borderRadius: {
      DEFAULT: "8px",
      full: "9999px"
    },
    fontFamily: {
      sans: [
        "Inter",
        "ui-sans-serif",
        "system-ui",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "sans-serif"
      ]
    },
    fontSize: {
      label: ["12px", { lineHeight: "1.5" }],
      "body-sm": ["13px", { lineHeight: "1.5" }],
      body: ["14px", { lineHeight: "1.5" }],
      lead: ["16px", { lineHeight: "1.5" }],
      h3: ["18px", { lineHeight: "1.25" }],
      h2: ["22px", { lineHeight: "1.25" }],
      h1: ["26px", { lineHeight: "1.25" }]
    },
    fontWeight: {
      normal: "400",
      medium: "500",
      semibold: "600"
    },
    boxShadow: {
      popover: "0 8px 24px rgb(23 32 27 / 0.12)"
    },
    extend: {
      height: {
        control: "40px",
        nav: "36px"
      },
      maxWidth: {
        content: "1120px"
      }
    }
  },
  plugins: []
};

export default config;

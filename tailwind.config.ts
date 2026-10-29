import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  darkMode: "class",
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}", "./src/lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", ...defaultTheme.fontFamily.sans],
      },
      fontSize: {
        xs: ["12px", { lineHeight: "1.5" }],
        sm: ["13px", { lineHeight: "1.5" }],
        base: ["14px", { lineHeight: "1.5" }],
        lg: ["16px", { lineHeight: "1.5" }],
        xl: ["17px", { lineHeight: "1.4" }],
        "2xl": ["20px", { lineHeight: "1.4" }],
        "3xl": ["24px", { lineHeight: "1.3" }],
        "4xl": ["28px", { lineHeight: "1.2" }],
      },
      fontWeight: { normal: "420" },
      colors: {
        info: "hsl(var(--info))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          foreground: "hsl(var(--danger-foreground))",
        },
        ink: "hsl(var(--foreground))",
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
      },
      boxShadow: {
        sm: "var(--elevation-sm)",
        DEFAULT: "var(--elevation-base)",
        md: "var(--elevation-md)",
        lg: "var(--elevation-lg)",
        xl: "var(--elevation-xl)",
        "2xl": "var(--elevation-2xl)",
        soft: "var(--elevation-base)",
      },
    },
  },
  plugins: [],
};

export default config;

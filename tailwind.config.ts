import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  /*
   * The public website's own utilities are generated into its lazily loaded
   * stylesheet instead (tailwind.site.config.ts via src/pages/site/site.css),
   * so a guest opening the menu downloads none of them.
   */
  content: [
    "./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}",
    "!./src/components/site/**", "!./src/pages/site/**",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
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
        sale: {
          DEFAULT: "hsl(var(--sale))",
          foreground: "hsl(var(--sale-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        gold: "hsl(var(--gold))",
        "gold-light": "hsl(var(--gold-light))",
        sage: "hsl(var(--sage))",
        "sage-dark": "hsl(var(--sage-dark))",
        "sage-light": "hsl(var(--sage-light))",
        cream: "hsl(var(--cream))",
        "cream-dark": "hsl(var(--cream-dark))",
        charcoal: "hsl(var(--charcoal))",
        "hero-sage": "hsl(var(--hero-sage))",
        /*
         * The public website's palette (src/pages/site), straight from the
         * brand: cream ground, forest headings, sage accent, warm grey text.
         * `sage-deep` is the sage darkened to 5:1 on cream, for small text.
         */
        ls: {
          cream: "#F7F4EC",
          paper: "#FBF9F4",
          sand: "#EFE9DD",
          forest: "#232E28",
          "forest-soft": "#2E3B34",
          sage: "#7E9B79",
          "sage-deep": "#56704F",
          grey: "#5B6158",
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
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.5s ease-out",
        "slide-up": "slide-up 0.6s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;

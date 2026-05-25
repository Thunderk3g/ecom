import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind v3.4 configuration.
 *
 * Two token layers cooperate here:
 *
 *  1. shadcn HSL tokens — `--background`, `--foreground`, `--primary`, etc.
 *     These are defined in `src/app/globals.css` (`:root` + `.dark`) as bare
 *     HSL triplets (e.g. `0 0% 100%`) so Tailwind can wrap them with the alpha
 *     channel via `hsl(var(--token) / <alpha-value>)`.
 *
 *  2. Per-tenant brand tokens — `--color-bg`, `--color-fg`, `--color-primary`,
 *     `--color-secondary`, `--font-sans`, `--font-serif`, `--radius`. These are
 *     injected at SSR by `src/app/layout.tsx` from `site_config` (see
 *     `src/lib/theme.ts`). globals.css derives the shadcn HSL tokens from these
 *     brand vars where it makes sense, so a tenant's `theme.color` flows through
 *     to the shadcn component palette without forks.
 *
 * Utilities that should track the tenant brand directly (e.g. `bg-brand`,
 * `text-brand-fg`, `font-serif`) reference the raw `--color-*` / `--font-*`
 * vars so they pick up the live SSR value.
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        // shadcn semantic tokens (HSL triplet vars + alpha support)
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Raw per-tenant brand vars (injected from site_config at SSR). Use
        // these for surfaces that must mirror the tenant's exact brand hex.
        brand: {
          DEFAULT: 'var(--color-primary)',
          secondary: 'var(--color-secondary)',
          bg: 'var(--color-bg)',
          fg: 'var(--color-fg)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'ui-serif', 'Georgia', 'serif'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
};

export default config;

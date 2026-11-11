import fs from 'node:fs';
import colors from 'tailwindcss/colors';
import { buildPalette } from './tailwind.palette.js';

// Design tokens: design/tokens.json is the single source (see design/README.md). The CSS variables that carry the
// dark-mode values are generated into src/styles/tokens.css.
const tokens = JSON.parse(fs.readFileSync(new URL('../../design/tokens.json', import.meta.url), 'utf8'));
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const palette = buildPalette(tokens, colors);
// Token groups carry a `_comment` key for people; Tailwind must not see it as a colour.
const strip = ({ _comment, ...rest }) => rest;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    screens: {
      'xs': '375px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        // The brand is Faida Blue. The old blue / indigo / purple families all point at it, so a page written
        // with `bg-blue-600` or `text-indigo-700` is on-brand without being rewritten.
        brand: tokens.brand,
        // Faida Navy (the logo wordmark) and Faida Orange (the logo stroke): `bg-navy`, `text-accent-text`, `bg-accent`.
        navy: strip(tokens.navy),
        accent: strip(tokens.accent),
        blue: tokens.brand,
        indigo: tokens.brand,
        purple: tokens.brand,
        violet: tokens.brand,
        sky: tokens.brand,
        cyan: tokens.brand,
        // Text in these families is used at the 600 shade; Tailwind's own 600s are below 4.5:1 on white, so they are darker here.
        green: { ...colors.green, 600: tokens.statusShades.green600 },
        emerald: { ...colors.emerald, 600: tokens.statusShades.emerald600 },
        amber: { ...colors.amber, 600: tokens.statusShades.amber600 },
        orange: { ...colors.orange, 600: tokens.statusShades.orange600 },
        // A second green family used as a module accent is the one success green.
        teal: { ...colors.emerald, 600: tokens.statusShades.emerald600 },
        // Neutrals are a cool, slightly violet grey; gray-100 is Cloud.
        gray: tokens.neutral,
        slate: tokens.neutral,
        zinc: tokens.neutral,
        stone: tokens.neutral,
      },
      // These utilities follow the theme: white and the light greys become dark surfaces under `.dark`, and the
      // grey text steps become light text. A page with no `dark:` classes of its own is therefore readable in dark
      // mode. An explicit `dark:` class still wins, so pages that were styled by hand look as they did.
      backgroundColor: {
        ...palette.backgroundColor,
        white: v('c-white'),
        gray: { 50: v('c-gray-50'), 100: v('c-gray-100'), 200: v('c-gray-200') },
      },
      borderColor: {
        ...palette.borderColor,
        white: v('c-white'),
        gray: { 100: v('c-gray-100'), 200: v('c-gray-200'), 300: v('c-gray-300') },
      },
      textColor: {
        ...palette.textColor,
        gray: { 400: v('c-text-400'), 500: v('c-text-500'), 600: v('c-text-600'), 700: v('c-text-700'), 800: v('c-text-800'), 900: v('c-text-900') },
      },
      borderRadius: {
        sm: `${tokens.radius.sm}px`, DEFAULT: `${tokens.radius.sm}px`, md: `${tokens.radius.md}px`,
        lg: `${tokens.radius.md}px`, xl: `${tokens.radius.lg}px`, '2xl': `${tokens.radius.xl}px`,
      },
      fontFamily: {
        sans: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
      boxShadow: {
        'sidebar': '2px 0 8px 0 rgba(0,0,0,0.06)',
        'card': '0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 16px 0 rgba(0,0,0,0.10), 0 1px 4px -1px rgba(0,0,0,0.06)',
        'card-lg': '0 8px 32px -4px rgba(0,0,0,0.12), 0 2px 8px -2px rgba(0,0,0,0.06)',
        'modal': '0 24px 64px -12px rgba(0,0,0,0.35)',
        'modal-sm': '0 12px 36px -8px rgba(0,0,0,0.25)',
        'glow-blue': '0 0 24px rgba(31,107,255,0.35)',
        'glow-green': '0 0 24px rgba(16,185,129,0.3)',
        'inner-sm': 'inset 0 1px 3px rgba(0,0,0,0.07)',
        'btn': '0 1px 2px rgba(0,0,0,0.08), 0 1px 1px rgba(0,0,0,0.04)',
      },
      animation: {
        'fade-in':    'fadeIn 0.15s ease-out',
        'fade-in-up': 'fadeInUp 0.2s cubic-bezier(0.16,1,0.3,1)',
        'slide-up':   'slideUp 0.2s cubic-bezier(0.16,1,0.3,1)',
        'slide-right':'slideRight 0.18s cubic-bezier(0.16,1,0.3,1)',
        'scale-in':   'scaleIn 0.15s cubic-bezier(0.16,1,0.3,1)',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'shimmer':    'shimmer 1.8s linear infinite',
        'bounce-in':  'bounceIn 0.4s cubic-bezier(0.36,0.07,0.19,0.97)',
      },
      keyframes: {
        fadeIn:     { from: { opacity: '0' },                              to: { opacity: '1' } },
        fadeInUp:   { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideUp:    { from: { opacity: '0', transform: 'translateY(8px)' },  to: { opacity: '1', transform: 'translateY(0)' } },
        slideRight: { from: { opacity: '0', transform: 'translateX(-8px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        scaleIn:    { from: { opacity: '0', transform: 'scale(0.95)' },      to: { opacity: '1', transform: 'scale(1)' } },
        pulseSoft:  { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
        shimmer:    { '0%': { backgroundPosition: '-200% center' }, '100%': { backgroundPosition: '200% center' } },
        bounceIn:   { '0%': { transform: 'scale(0.96)' }, '60%': { transform: 'scale(1.02)' }, '100%': { transform: 'scale(1)' } },
      },
    },
  },
  plugins: [
    // CSS variables behind the status and brand utilities above (light values on :root, dark values under .dark)
    ({ addBase }) => addBase(palette.vars),
  ],
};

# Faida design tokens

One source for the look of every app: **Faida Blue `#1F6BFF` and Faida Navy `#0A2A55` on Cloud `#F3F6FC`, with Faida Orange `#F26A0C` as the accent**, taken from the Faida POS logo.

| File | Role |
|---|---|
| `tokens.json` | The source. Brand scale, neutrals, status colours, dark-mode values, radius, spacing, type sizes. |
| `build-tokens.mjs` | Generates the platform files from it. |

```bash
npm run tokens         # write the generated files
npm run tokens:check   # fail if any is out of date (also run by the web unit tests)
```

Generated from `tokens.json`:

- `apps/web/src/styles/tokens.css` - the CSS variables behind `bg-white`, `bg-gray-*` and `text-gray-*`, with their
  dark-mode values under `.dark`.
- `apps/mobile-*/constants/tokens.ts` - `Brand`, `Neutral`, `Status`, `Radius`, `Space`, `FontSize`, `TOUCH_TARGET`
  and `BaseColors`. Each mobile app's `constants/theme.ts` builds its `Colors` from `BaseColors`. The mobile apps are
  outside the npm workspace, so they cannot import this package and get a copy.

- `apps/admin/src/generated/tokens.ts` - the admin console's `C` palette (inline styles, append two hex digits for
  transparency: `${C.blue}1f`); `apps/admin/src/generated/tokens.css` and `apps/landing/tokens.css` - the same colours as
  CSS variables (`--bg`, `--card`, `--text`, `--accent`, `--brand-600` ...) for the admin's global rules and the landing site;
  `docs/templates/manual-tokens.css` is the same file, which `scripts/build-docs.sh` puts in front of the user manual's styles.
  Both are the light Mist and Faida Blue look. Blue, purple, cyan and indigo are all brand shades there; green, amber and
  red use the `statusText` shades so they stay readable on their own 12% tint.

`apps/web/tailwind.config.js` reads `tokens.json` directly.

## Rules

- Change a colour in `tokens.json`, run `npm run tokens`, never in a page.
- **Web:** the old `blue`, `indigo`, `purple`, `violet`, `sky` and `cyan` Tailwind families all point at the brand scale, and
  `gray`/`slate`/`zinc`/`stone` at the neutral scale, so existing pages are on-brand. Write new code with `brand-*` and
  `gray-*`. Use the components in `apps/web/src/components/ui` (Button, Input, Select, Card, Badge, Tabs, Menu, StatTile,
  EmptyState, PageHeader) instead of hand-built controls.
- One Faida Blue primary action per screen. Colour carries meaning: green, amber and red are statuses; blue is the brand, navy carries it on dark panels and top bars, and orange is a small accent (never body text: use `accent.text`).
  A module does not get its own accent.
- Text must reach 4.5:1 (3:1 for large text). `apps/web/src/styles/__tests__/tokens.test.ts` checks every pairing the
  theme uses; add a case when you add a pairing. The 600 shades of green, emerald, amber and orange are darkened for this.
- No emoji. Use a lucide icon (web) or an Ionicons icon (mobile).

## Cards, hover and motion

Every card you can click uses one behaviour (defined in `apps/web/src/index.css`):

| Class / component | Use |
|---|---|
| `Card` (add `interactive` and `onClick`) | A white card that is a button: focusable, Enter and Space work. |
| `ActionCard` | An icon tile, a title and a line of text that goes somewhere. `layout="stack"` for a grid of tiles. |
| `.surface-interactive` | The same look on a native `<button>` or a clickable `<div>` (add `role="button" tabIndex={0}` and a key handler to a div). |
| `.lift` | The behaviour only, for cards that carry their own colours (table tiles). |
| `.stagger` on a grid | Children arrive one after another (45 ms apart, up to nine). |
| `.bar-fill` | A progress bar that grows in from the left. |
| `AnimatedValue` | A figure that counts up to its value. |

Behaviour: a 2px lift, a Faida Blue border and glow, the icon tile fills with blue and the arrow leans forward on hover; it settles when pressed;
a clear ring shows for the keyboard. Hover effects apply only where there is a real pointer, and everything stops for people who ask their
system for reduced motion (spinners keep spinning). A card that only shows data (`StatTile`, `Card` without `interactive`) does not move.

Two traps: an entrance animation must use `animation-fill-mode: backwards`, because `both` or `forwards` holds the end state and freezes the
hover transform; and keep hover styles inside `@media (hover: hover) and (pointer: fine)`. `motion.test.ts` pins both.

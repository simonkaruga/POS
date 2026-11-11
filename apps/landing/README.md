# Faida POS — Landing Site

The public marketing site and HTML user manual. Plain static HTML — **no build step,
no framework, no dependencies**.

---

## Pages

| File | Purpose |
|---|---|
| `index.html` | Home / product overview |
| `about.html` | About |
| `contact.html` | Contact |
| `setup-guide.html` | Getting-started guide for new operators |
| `faida-pos-manual.html` | **Generated** — the user manual. See below |
| `terms.html` | Terms of service |
| `privacy.html` | Privacy policy |
| `kdpa.html` | Kenya Data Protection Act compliance statement |

Assets (`favicon.png`, `posfav.png`, images) sit alongside the pages.

## Look

Light Cloud with Faida Blue, the same as the web app. Every page links `tokens.css`, which is
**generated** from [`design/tokens.json`](../../design/tokens.json) by `npm run tokens` (never edit it, and do not
put a `:root` colour block back in a page). Write colours as `var(--accent)`, `var(--text)`, `var(--green)`; the
older names (`--bg2`, `--blue`, `--text2`...) are kept as aliases. The user manual gets the same variables from
`docs/templates/manual-tokens.css` when `scripts/build-docs.sh` runs. Third-party brand colours (Shopify, Xero,
Google...) in the download and integration tiles are deliberately left as they are.

## faida-pos-manual.html is generated — do not edit it

It is built from [`docs/user-guide.md`](../../docs/user-guide.md) by
[`scripts/build-docs.sh`](../../scripts/build-docs.sh), using the pandoc template and
stylesheet in `docs/templates/`. Editing the HTML directly means your change is
overwritten on the next build.

```bash
scripts/build-docs.sh --html      # fast; no LaTeX needed
```

This page used to be hand-maintained in parallel with a separate markdown manual, and
the two drifted badly — the HTML mentioned franchise 14 times while the markdown never
mentioned it at all. One generated source removes that failure mode.

Only the **user** guide is published here. The admin and super-admin guides are not.

---

## Local preview

Any static server works:

```bash
npx serve apps/landing
# or
python3 -m http.server 8080 --directory apps/landing
```

---

## Deploy — domain substitution

The pages have no runtime environment, so app and API origins are **rewritten at
deploy time** by [apply-domains.mjs](apply-domains.mjs). Run it in the deploy step
after setting the env vars:

```bash
FAIDA_WEB_ORIGIN=https://app.your-domain.com \
FAIDA_API_ORIGIN=https://api.your-domain.com \
node apps/landing/apply-domains.mjs
```

It swaps the known current origins across every HTML file. It is **idempotent** — it
only replaces the specific origins it knows about, so re-running is safe. With
neither env var set it exits without touching anything.

Pointing a new domain is therefore a deploy-config change, never a code change.

---

When you add a page or change a linked app/API origin, update this README — and add
any new origin to the `MAP` in `apply-domains.mjs`, or it will not be rewritten on
deploy.

#!/usr/bin/env bash
#
# Build every documentation output from its single markdown source.
#
#   docs/user-guide.md         -> FAIDA_POS_User_Guide.pdf
#                              -> apps/landing/faida-pos-manual.html
#   docs/admin-guide.md        -> FAIDA_POS_Admin_Guide.pdf
#   docs/super-admin-guide.md  -> apps/admin/src/generated/superAdminGuide.ts
#
# The markdown files are the ONLY things you edit. Everything above is generated
# and overwritten, which is the whole point: the manual used to exist as six
# hand-maintained copies that drifted apart.
#
# Usage:
#   scripts/build-docs.sh          # build everything
#   scripts/build-docs.sh --html   # skip the PDFs (fast; no LaTeX needed)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

DOCS="$ROOT/docs"
TPL="$DOCS/templates"
SKIP_PDF=0
[[ "${1:-}" == "--html" ]] && SKIP_PDF=1

DATE="$(date +'%d %B %Y')"

# ── Preconditions ────────────────────────────────────────────────────────────
if ! command -v pandoc >/dev/null 2>&1; then
  cat >&2 <<'MSG'
pandoc is required but not installed.

  Ubuntu/Debian : sudo apt install pandoc
  macOS         : brew install pandoc
  Windows       : https://pandoc.org/installing.html

For PDF output you also need LaTeX:
  sudo apt install texlive-latex-base texlive-fonts-recommended texlive-latex-extra
MSG
  exit 1
fi

# Pick a PDF engine. lualatex/xelatex handle the box-drawing characters in the
# architecture diagrams natively; pdflatex chokes on them ("Unicode character not
# set up for use with LaTeX"), so for pdflatex we transliterate to ASCII first.
PDF_ENGINE=""
for e in lualatex xelatex pdflatex; do
  if command -v "$e" >/dev/null 2>&1; then PDF_ENGINE="$e"; break; fi
done

if [[ $SKIP_PDF -eq 0 && -z "$PDF_ENGINE" ]]; then
  echo "No LaTeX engine found — skipping PDFs. Install texlive, or run with --html." >&2
  SKIP_PDF=1
fi

echo "Building documentation from $DOCS"
echo

# ── 1. PDFs ──────────────────────────────────────────────────────────────────
# Transliterate box-drawing glyphs to ASCII. pdflatex cannot typeset them at all
# ("Unicode character not set up for use with LaTeX"). We convert rather than strip
# — stripping leaves the diagrams as gibberish, which is what the old build did.
to_ascii() {
  sed -e 's/[─━]/-/g'  -e 's/[│┃]/|/g' \
      -e 's/[┌┏╔]/+/g' -e 's/[┐┓╗]/+/g' \
      -e 's/[└┗╚]/+/g' -e 's/[┘┛╝]/+/g' \
      -e 's/[├┣]/+/g'  -e 's/[┤┫]/+/g' \
      -e 's/[┬┳]/+/g'  -e 's/[┴┻]/+/g'  -e 's/[┼╋]/+/g' \
      -e 's/[▼▾]/v/g'  -e 's/[▲▴]/^/g'  -e 's/→/->/g' -e 's/←/<-/g' \
      -e 's/×/x/g'     -e 's/…/.../g' \
      "$1"
}

run_pandoc_pdf() {
  local input="$1" out="$2" subtitle="$3" engine="$4"
  shift 4
  pandoc "$input" \
    -o "$out" \
    --pdf-engine="$engine" \
    --toc --toc-depth=2 \
    "$@" \
    -V geometry:margin=1in \
    -V fontsize=11pt \
    -V documentclass=report \
    -V papersize=a4 \
    -V colorlinks=true \
    -V linkcolor=blue \
    -V urlcolor=blue \
    -V toccolor=black \
    --highlight-style=tango \
    --metadata title="Faida POS" \
    --metadata subtitle="$subtitle" \
    --metadata author="Faida Systems" \
    --metadata date="$DATE"
}

build_pdf() {
  local src="$1" out="$2" subtitle="$3"

  # Preferred: a Unicode-native engine, which keeps the diagrams as drawn.
  # Some texlive installs ship lualatex/xelatex without the fonts they need, so
  # a failure here is expected and non-fatal — we fall back rather than die.
  if [[ "$PDF_ENGINE" != "pdflatex" ]]; then
    if run_pandoc_pdf "$src" "$out" "$subtitle" "$PDF_ENGINE" \
         -V mainfont="DejaVu Sans" -V monofont="DejaVu Sans Mono" >/dev/null 2>&1; then
      echo "  PDF   $(basename "$src")  ->  $(basename "$out")   [$PDF_ENGINE]"
      return 0
    fi
    echo "        $PDF_ENGINE unavailable for typesetting — falling back to pdflatex" >&2
  fi

  if ! command -v pdflatex >/dev/null 2>&1; then
    echo "        no working LaTeX engine — skipped $(basename "$out")" >&2
    return 0
  fi

  local tmp; tmp="$(mktemp --suffix=.md)"
  to_ascii "$src" > "$tmp"
  if run_pandoc_pdf "$tmp" "$out" "$subtitle" pdflatex; then
    echo "  PDF   $(basename "$src")  ->  $(basename "$out")   [pdflatex, diagrams as ASCII]"
  else
    echo "        FAILED to build $(basename "$out")" >&2
  fi
  rm -f "$tmp"
  return 0
}

if [[ $SKIP_PDF -eq 0 ]]; then
  build_pdf "$DOCS/user-guide.md"  "$ROOT/FAIDA_POS_User_Guide.pdf"  "User Guide"
  build_pdf "$DOCS/admin-guide.md" "$ROOT/FAIDA_POS_Admin_Guide.pdf" "Admin & Installation Guide"
else
  echo "  PDF   (skipped)"
fi

# ── 2. Landing-site HTML (user guide only — customers must not get admin docs) ─
echo "  HTML  user-guide.md  ->  apps/landing/faida-pos-manual.html"
pandoc "$DOCS/user-guide.md" \
  -o "$ROOT/apps/landing/faida-pos-manual.html" \
  --standalone \
  --template="$TPL/manual.html" \
  --toc --toc-depth=2 \
  --highlight-style=breezedark \
  --metadata title="Faida POS" \
  --metadata subtitle="User Guide" \
  --metadata audience="owners, managers and shop-floor staff" \
  --metadata date="$DATE" \
  --variable styles="$(cat "$TPL/manual-tokens.css" "$TPL/manual.css")"

# ── 3. Super-admin guide -> a TS module the admin console imports ────────────
# Rendered to an HTML fragment at build time so the console needs no markdown
# renderer at runtime and works with no network.
echo "  TS    super-admin-guide.md  ->  apps/admin/src/generated/superAdminGuide.ts"
mkdir -p "$ROOT/apps/admin/src/generated"
SA_HTML="$(pandoc "$DOCS/super-admin-guide.md" -t html --toc --toc-depth=2)"
SA_HTML="$SA_HTML" node -e '
const fs = require("fs");
const html = process.env.SA_HTML;
const out =
  "// GENERATED FILE — DO NOT EDIT.\n" +
  "// Source: docs/super-admin-guide.md\n" +
  "// Regenerate: scripts/build-docs.sh\n\n" +
  "export const SUPER_ADMIN_GUIDE_HTML = " + JSON.stringify(html) + ";\n";
fs.writeFileSync("apps/admin/src/generated/superAdminGuide.ts", out);
'

echo
echo "Done."
[[ $SKIP_PDF -eq 0 ]] && {
  for f in FAIDA_POS_User_Guide.pdf FAIDA_POS_Admin_Guide.pdf; do
    [[ -f "$ROOT/$f" ]] && echo "  $f  ($(du -h "$ROOT/$f" | cut -f1))"
  done
}
echo "  apps/landing/faida-pos-manual.html  ($(du -h "$ROOT/apps/landing/faida-pos-manual.html" | cut -f1))"
echo "  apps/admin/src/generated/superAdminGuide.ts"

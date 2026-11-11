# Documentation

Three guides, three audiences, **one source each**. Everything else is generated.

| Source | Audience | Generated into |
|---|---|---|
| [user-guide.md](user-guide.md) | Owners, managers, cashiers, waiters, kitchen, accounts | `FAIDA_POS_User_Guide.pdf` · `apps/landing/faida-pos-manual.html` |
| [admin-guide.md](admin-guide.md) | Whoever installs and maintains the server | `FAIDA_POS_Admin_Guide.pdf` |
| [super-admin-guide.md](super-admin-guide.md) | Platform operators | `apps/admin/src/generated/superAdminGuide.ts` → the **Guide** page in the admin console |

**Edit only the three markdown files.** Then:

```bash
scripts/build-docs.sh          # everything
scripts/build-docs.sh --html   # skip PDFs (fast, no LaTeX needed)
```

Commit the generated outputs — the landing site serves the HTML and the admin app
imports the TypeScript module, so a build that skips them breaks both.

---

## Why it works this way

The manual previously existed as **six hand-maintained copies**: four `USER_MANUAL_PART*.md`
files, a concatenated `FAIDA_POS_COMPLETE_MANUAL.md`, a PDF, and a separately
hand-written `apps/landing/faida-pos-manual.html`.

They drifted, exactly as you would expect. The landing HTML covered franchise 14
times while the markdown never mentioned it once; the markdown had no payroll tax
content at all while the HTML still said NHIF, which the app had already renamed to
SHIF. Nobody was at fault — two hand-maintained copies of the same document always
end up disagreeing.

One source per audience, everything else generated, is the fix.

## Why the super-admin guide is not published

It documents impersonating a tenant, deleting a business, and comping an account.
Customers have no business reading it, so it is compiled into the admin console
instead of the public site. `build-docs.sh` never emits it to `apps/landing/`.

## Requirements

- **pandoc** — required. `sudo apt install pandoc`
- **LaTeX** — only for the PDFs. `sudo apt install texlive-latex-base texlive-fonts-recommended texlive-latex-extra`

The script prefers `lualatex`/`xelatex`, which typeset the box-drawing characters in
the architecture diagrams as drawn. If neither is usable it falls back to `pdflatex`
and transliterates those diagrams to ASCII — converted, not stripped, so they stay
readable. Without any LaTeX engine it builds the HTML and skips the PDFs.

## Editing

Write for the reader, not the codebase. The user guide is task-shaped —
*how do I refund someone* — not feature-shaped.

- `#` headings are **parts** (they become sidebar group labels)
- `##` headings are **sections** (they become the clickable sidebar entries)
- Tables render well in all three outputs; wide ones scroll rather than stretch
- Blockquotes (`>`) become highlighted callouts — use them for the thing that will
  otherwise bite someone

## Keeping it current

When a user-facing feature is added or changed, update the guide that covers it **in
the same change** and rerun the build. A feature that ships undocumented is a support
call already scheduled.

Developer-facing docs are separate — those are the `README.md` files in each app and
package. See the [root README](../README.md#per-app-documentation).

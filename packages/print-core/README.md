# @pos/print-core

One receipt, kitchen-ticket and bill layout for every Faida print path. Pure TypeScript with a
single dependency (`qrcode-generator`), so it runs in the web app, the Expo apps and plain Node.

## Why it exists

Receipts used to be built four separate times (ESC/POS, HTML, Star XML, Epson XML) in the web app and a
fifth time in the mobile app. They drifted: a voided sale printed as a normal receipt on a Star printer, and
mobile receipts had no KRA eTIMS section at all. Now **what is printed is decided once**, in `layout.ts`, and the
serializers only decide how a block looks on their medium.

```
ReceiptDocument / KotDocument / BillDocument      (model.ts)
        |  layoutReceipt / layoutKot / layoutBill (layout.ts)  -> Block[]
        |
        +-- renderEscPos     (escpos.ts)  raw bytes: USB, Bluetooth, LAN, installed printer
        +-- renderHtml       (html.ts)    browser / OS print dialog; QR is an inline SVG, no script
        +-- renderEpsonXml   (epson.ts)   Epson ePOS-Print
        +-- renderStarXml    (star.ts)    Star WebPRNT (wire format unverified, see below)
```

## Rules the layout enforces

- Status banners come first and cannot be skipped by a printer type: VOID, CREDIT SALE, PENDING KRA
  SUBMISSION, `COPY n - NOT THE ORIGINAL` (set `copyNumber` on a reprint), `TEST MODE - NOT A TAX INVOICE` (`etimsTestMode`) and
  `OFFLINE SALE - PROVISIONAL RECEIPT` (`offlineSale`).
- A voided receipt never reads "KRA eTIMS VERIFIED" and prints no QR; it shows the original control number.
- The cash drawer pulse is only added for an original cash sale (`receiptOpensDrawer` is the one rule the bytes and the audit log both use). A reprint (`copyNumber > 0`) or a void never
  opens it, so repeated "Print" presses cannot be used to pop the drawer.
- ESC/POS text is reduced to printable ASCII (`asciiSafe`) and command bytes are emitted as raw bytes, never
  through UTF-8. The KRA QR uses the printer's built-in QR commands (`GS ( k`).
- Money and dates are formatted by our own code (`formatKES`, `formatDateTime`), not `Intl`, so output is the
  same on Hermes, Node and every browser.
- `subtotalCents` on a `ReceiptDocument` INCLUDES VAT/TOT when prices are tax-inclusive; the layout prints
  `subtotal - vat - tot` as the ex-tax subtotal. The mobile app converts its pre-tax subtotal in
  `toReceiptDocument`.

## Kitchen routing (`kotRouting.ts`)

`resolveStation(item)` -> `KOT_FOOD | KOT_DRINKS | KOT_DESSERTS | KOT_*`: an explicit `station` on the item wins
(`KITCHEN`/`BAR`/`DESSERT` as stored on items, or a `KOT_*` handle), then a whole-word keyword guess from the
category or name, then `KOT_FOOD`. `routeKotItems(items, printers)` groups a ticket by station and attaches the
printer whose `handles` include it.

## Using it

- **Web**: aliased in `apps/web/vite.config.ts` and `tsconfig.json`. `src/lib/printer.ts` is the only place that
  decides where bytes go.
- **mobile-pos**: `"@pos/print-core": "file:../../packages/print-core"` (same pattern as `@pos/mobile-push`).
  `lib/receiptModel.ts#toReceiptDocument` adapts the screens' receipt shape.

```bash
cd packages/print-core
npm test          # jest (ts-jest, plain Node)
npm run typecheck
```

## Testing on a real printer

`layoutDiagnostic` builds a numbered test page (columns, alignment, styles, wrapping, characters, banners, QR, cut) and
is reachable from Settings -> Printers on web and mobile ("Print full test page"), plus a "Test cash drawer" button on web.
[HARDWARE_TEST.md](HARDWARE_TEST.md) is the checklist and the table to fill in for each printer model.

## Known gaps

- Star WebPRNT XML keeps the wire format of the old generator and has not been checked against a Star printer.
- Only one VAT rate (16%) / TOT (3%) / service charge (10%) is labelled; per-item tax bands are not modelled.
- No real thermal printer has printed this output yet. The tests assert bytes and text, not paper: run HARDWARE_TEST.md.

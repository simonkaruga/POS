// A page that exposes the things that go wrong on real printers, so a person with a printer and a pencil can
// check each one in a minute instead of guessing from a sale: clipped or wrapped columns, amounts that do not
// line up on the right edge, text sizes and bold, the characters the printer cannot show, a QR that does not
// scan, and that a cut happens. Built from the same blocks as a receipt, so it exercises the real serializers.

import type { Block } from './layout';
import { PAPER_COLUMNS, type PaperWidth } from './model';

const QR_SAMPLE = 'https://etims.kra.go.ke/verify?test=FAIDA-PRINTER-TEST';

/** `1234567890` repeated to exactly `cols` characters, ends marked so a clipped edge is obvious. */
export function columnRuler(cols: number): string {
  let s = '';
  for (let i = 1; i <= cols; i++) s += String(i % 10);
  return '|' + s.slice(1, cols - 1) + '|';
}

export function layoutDiagnostic(paperWidth: PaperWidth, when: string = new Date().toISOString()): Block[] {
  const cols = PAPER_COLUMNS[paperWidth];
  const b: Block[] = [];

  b.push({ kind: 'banner', text: 'PRINTER TEST', tone: 'info' });
  b.push({ kind: 'line', text: `Paper ${paperWidth} mm, ${cols} columns`, align: 'center', bold: true });
  b.push({ kind: 'line', text: when.slice(0, 16).replace('T', ' '), align: 'center', size: 'small' });
  b.push({ kind: 'rule', style: 'double' });

  b.push({ kind: 'line', text: '1. COLUMNS: both | marks must be visible' });
  b.push({ kind: 'line', text: columnRuler(cols) });
  b.push({ kind: 'line', text: `Expect ${cols} characters per line.`, size: 'small' });
  b.push({ kind: 'rule', style: 'dash' });

  b.push({ kind: 'line', text: '2. ALIGNMENT: amounts end at the same edge' });
  b.push({ kind: 'row', left: 'Subtotal (ex-VAT):', right: 'KES 818.97' });
  b.push({ kind: 'row', left: 'VAT (16%):', right: 'KES 131.03' });
  b.push({ kind: 'row', left: 'A very long item name that must give way', right: 'KES 1,234,567.89' });
  b.push({ kind: 'row', left: 'TOTAL:', right: 'KES 950.00', bold: true, size: 'large' });
  b.push({ kind: 'rule', style: 'dash' });

  b.push({ kind: 'line', text: '3. STYLES' });
  b.push({ kind: 'line', text: 'Normal text' });
  b.push({ kind: 'line', text: 'Bold text', bold: true });
  b.push({ kind: 'line', text: 'Small text', size: 'small' });
  b.push({ kind: 'line', text: 'Large text', size: 'large' });
  b.push({ kind: 'line', text: 'XL 12', size: 'xl', bold: true });
  b.push({ kind: 'line', text: 'Left', align: 'left' });
  b.push({ kind: 'line', text: 'Center', align: 'center' });
  b.push({ kind: 'line', text: 'Right', align: 'right' });
  b.push({ kind: 'rule', style: 'dash' });

  b.push({ kind: 'line', text: '4. WRAPPING: no word cut in the middle' });
  b.push({ kind: 'line', text: 'Cappuccino large with extra shot and oat milk and caramel drizzle', bold: true });
  b.push({ kind: 'line', text: 'Supercalifragilisticexpialidocious_unbroken_word_longer_than_a_line' });
  b.push({ kind: 'rule', style: 'dash' });

  b.push({ kind: 'line', text: '5. CHARACTERS: should read as plain letters' });
  b.push({ kind: 'line', text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
  b.push({ kind: 'line', text: 'abcdefghijklmnopqrstuvwxyz' });
  b.push({ kind: 'line', text: '0123456789 !"#$%&\'()*+,-./:;<=>?@[]^_`{|}~' });
  b.push({ kind: 'line', text: 'Café – Naïve “quotes” × 3 €5' });
  b.push({ kind: 'line', text: 'Expect: Cafe - Naive "quotes" x 3 EUR5', size: 'small' });
  b.push({ kind: 'rule', style: 'dash' });

  b.push({ kind: 'line', text: '6. BANNERS' });
  b.push({ kind: 'banner', text: '*** COPY 1 - NOT THE ORIGINAL ***', tone: 'copy' });
  b.push({ kind: 'banner', text: '*** PENDING KRA SUBMISSION ***', tone: 'pending' });
  b.push({ kind: 'rule', style: 'dash' });

  b.push({ kind: 'line', text: '7. QR: scan with a phone', align: 'center' });
  b.push({ kind: 'qr', data: QR_SAMPLE });
  b.push({ kind: 'line', text: 'It should open the KRA verify page address.', align: 'center', size: 'small' });
  b.push({ kind: 'rule', style: 'double' });

  b.push({ kind: 'line', text: 'END OF TEST: the paper should cut now.', align: 'center', bold: true });
  b.push({ kind: 'gap' });
  return b;
}

#!/usr/bin/env node
/**
 * Deploy-time domain substitution for the static landing site.
 *
 * The landing pages are plain HTML (no runtime env), so we rewrite the app/API
 * origins from environment variables at build/deploy time. Run this in your
 * deploy step (e.g. a Vercel/Netlify build command) AFTER setting the env vars —
 * then buying/pointing a new domain never requires a code change.
 *
 *   FAIDA_WEB_ORIGIN   web app origin   (default keeps the current value)
 *   FAIDA_API_ORIGIN   API origin       (default keeps the current value)
 *
 * Example:
 *   FAIDA_WEB_ORIGIN=https://app.mycompany.co.ke \
 *   FAIDA_API_ORIGIN=https://api.mycompany.co.ke \
 *   node apply-domains.mjs
 *
 * Idempotent: it only swaps the known current origins, so re-running is safe.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

// current origin  ->  env var that overrides it
const MAP = [
  { from: 'https://faida-pos.vercel.app', env: 'FAIDA_WEB_ORIGIN' },
  { from: 'https://faida-api.onrender.com',    env: 'FAIDA_API_ORIGIN' },
  // Dev origins, listed so a stray one is rewritten instead of shipping.
  // Six pages reached production with their Log in and Start Free buttons
  // pointing at http://localhost:3001, which goes nowhere for a visitor.
  { from: 'http://localhost:3001',            env: 'FAIDA_WEB_ORIGIN' },
  { from: 'http://localhost:3005',            env: 'FAIDA_WEB_ORIGIN' },
  { from: 'http://localhost:3010',            env: 'FAIDA_API_ORIGIN' },
];

const subs = MAP
  .map(({ from, env }) => ({ from, to: process.env[env] }))
  .filter((s) => s.to && s.to !== s.from)
  .map((s) => ({ ...s, to: s.to.replace(/\/$/, '') }));

if (subs.length === 0) {
  console.log('[apply-domains] no origin env vars set — leaving HTML unchanged.');
  process.exit(0);
}

const htmlFiles = readdirSync(DIR).filter((f) => f.endsWith('.html'));
let total = 0;
for (const file of htmlFiles) {
  const path = join(DIR, file);
  let html = readFileSync(path, 'utf8');
  let count = 0;
  for (const { from, to } of subs) {
    const parts = html.split(from);
    count += parts.length - 1;
    html = parts.join(to);
  }
  if (count > 0) { writeFileSync(path, html); total += count; console.log(`[apply-domains] ${file}: ${count} replaced`); }
}
console.log(`[apply-domains] done — ${total} replacement(s) across ${htmlFiles.length} file(s).`);
console.log('[apply-domains] mapping:', subs.map((s) => `${s.from} -> ${s.to}`).join(', '));

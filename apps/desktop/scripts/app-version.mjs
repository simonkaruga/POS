#!/usr/bin/env node
/**
 * The desktop app's version lives in four files that must agree, because the updater compares the installed version with the
 * one in the release: src-tauri/tauri.conf.json (what the app and the installer report), src-tauri/Cargo.toml (+ Cargo.lock)
 * and package.json.
 *
 *   node scripts/app-version.mjs                      print the version (fails if the files disagree)
 *   node scripts/app-version.mjs --check              same, for CI
 *   node scripts/app-version.mjs --check-tag desktop-v1.2.0     also fail unless the release tag matches
 *   node scripts/app-version.mjs --set 1.2.0          change all four
 *
 * To ship an update: --set the new version, commit, then `git tag desktop-v1.2.0 && git push origin desktop-v1.2.0`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  tauri: join(root, 'src-tauri', 'tauri.conf.json'),
  cargo: join(root, 'src-tauri', 'Cargo.toml'),
  lock: join(root, 'src-tauri', 'Cargo.lock'),
  npm: join(root, 'package.json'),
};
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

// Windows checks files out with \r\n line ends, so every pattern that spans a line break accepts both.
const jsonVersion = /("version"\s*:\s*")([^"]+)(")/;
const cargoVersion = /(\[package\][^[]*?\r?\nversion\s*=\s*")([^"]+)(")/;
const lockVersion = /(name = "faida-pos-desktop"\r?\nversion = ")([^"]+)(")/;

const patterns = { tauri: jsonVersion, cargo: cargoVersion, lock: lockVersion, npm: jsonVersion };

export function readVersions(read = (f) => readFileSync(f, 'utf8')) {
  const out = {};
  for (const [name, file] of Object.entries(files)) {
    const m = patterns[name].exec(read(file));
    out[name] = m ? m[2] : undefined;
  }
  return out;
}

export function setVersion(version, read = (f) => readFileSync(f, 'utf8'), write = (f, s) => writeFileSync(f, s)) {
  if (!SEMVER.test(version)) throw new Error(`"${version}" is not a version like 1.2.0`);
  for (const [name, file] of Object.entries(files)) {
    const text = read(file);
    if (!patterns[name].test(text)) throw new Error(`Could not find the version in ${file}`);
    write(file, text.replace(patterns[name], `$1${version}$3`));
  }
}

/** Returns a problem description, or null when all is well. */
export function problem(versions, tag) {
  const distinct = [...new Set(Object.values(versions))];
  if (distinct.length !== 1 || !distinct[0]) {
    return `The version differs between files: ${Object.entries(versions).map(([k, v]) => `${k}=${v ?? 'missing'}`).join(', ')}. Run: node scripts/app-version.mjs --set <version>`;
  }
  if (!SEMVER.test(distinct[0])) return `"${distinct[0]}" is not a version like 1.2.0`;
  if (tag !== undefined && tag !== `desktop-v${distinct[0]}`) {
    return `The release tag is ${tag} but the app version is ${distinct[0]} (expected tag desktop-v${distinct[0]}). Change the version with --set, commit, and tag again.`;
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--set') {
      setVersion(args[1] ?? '');
      console.log(`Version set to ${args[1]} in ${Object.keys(files).length} files.`);
    } else {
      const tag = args[0] === '--check-tag' ? args[1] : undefined;
      const versions = readVersions();
      const bad = problem(versions, tag);
      if (bad) throw new Error(bad);
      console.log(versions.tauri);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

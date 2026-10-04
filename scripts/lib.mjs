// Shared helpers for the extract-my-profile scripts. Node built-ins only.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_ENV = 'EXTRACT_MY_PROFILE_ROOT';
export const DEFAULT_ROOT_DIR = 'profiles';
export const NO_CATEGORY = 'None';
export const REGISTRY_FILE = 'PROFILES.md';
export const STATE_FILE = 'CURRENT-STATE.md';
export const SNAPSHOT_DIR = '_SNAPSHOTS';
export const TOOL_NAME = 'extract-my-profile/snapshot.mjs';
export const EXIT = Object.freeze({ OK: 0, CHECK_FAILED: 1, USAGE: 2 });

export const PAGE_RE = /^[a-z0-9-]+$/;
const SNAPSHOT_NAME_RE = /^\d{4}-\d{2}-\d{2}-\d{4}-.+\.txt$/;
const RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export class UsageError extends Error {}

// ---------------------------------------------------------------- text helpers

/** CRLF/CR to LF, trailing spaces and tabs stripped per line, outer blank lines dropped, one final newline. */
// Must stay identical to the normalization in browser-capture.js; tests/capture.test.mjs checks parity.
// Non-breaking spaces become spaces and zero-width characters are dropped, because a copy of the page
// text cannot carry them reliably. No visible character changes.
export function normalizeBody(text) {
  const lines = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/^ | $/g, ''));
  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Matching form for approved-text comparison only. Case is preserved. */
export function normalizeForMatch(text) {
  return String(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

// ---------------------------------------------------------------------- dates

export function localRfc3339(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isValidDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Splits an RFC 3339 timestamp into the local date and time it states. Returns null when invalid. */
export function parseRfc3339(value) {
  const match = RFC3339_RE.exec(value ?? '');
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (!isValidDate(date)) return null;
  const [hour, minute, second] = [Number(match[4]), Number(match[5]), Number(match[6])];
  if (hour > 23 || minute > 59 || second > 60) return null;
  return { date, hhmm: `${match[4]}${match[5]}` };
}

// ------------------------------------------------------------------ snapshots

export function formatSnapshot({ url, captured_at, page, body, capture_check = 'none' }) {
  const normalized = normalizeBody(body);
  return [
    `url: ${url}`,
    `captured_at: ${captured_at}`,
    `page: ${page}`,
    `sha256: ${sha256(normalized)}`,
    `capture_check: ${capture_check}`,
    `tool: ${TOOL_NAME}`,
    '---',
    '',
  ].join('\n') + normalized;
}

/** Parses a snapshot file. Throws Error with a readable message when the layout is wrong. */
export function parseSnapshot(fileText) {
  const text = String(fileText).replace(/^\uFEFF/, '');
  const headers = {};
  let pos = 0;
  let separated = false;
  while (pos < text.length) {
    const newline = text.indexOf('\n', pos);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(pos, end).replace(/\r$/, '');
    pos = newline === -1 ? text.length : newline + 1;
    if (line === '---') {
      separated = true;
      break;
    }
    const match = /^([a-z_0-9]+): ?(.*)$/.exec(line);
    if (!match) throw new Error(`unexpected header line "${line.slice(0, 60)}"`);
    headers[match[1]] = match[2];
  }
  if (!separated) throw new Error('missing "---" separator line');
  for (const key of ['url', 'captured_at', 'page', 'sha256']) {
    if (!headers[key]) throw new Error(`missing header "${key}"`);
  }
  return {
    url: headers.url,
    captured_at: headers.captured_at,
    page: headers.page,
    sha256: headers.sha256,
    tool: headers.tool ?? null,
    body: text.slice(pos),
  };
}

/** Recomputes the body hash. Returns {ok, expected, actual} or {ok:false, error}. */
export function verifySnapshot(fileText) {
  let parsed;
  try {
    parsed = parseSnapshot(fileText);
  } catch (error) {
    return { ok: false, error: `malformed snapshot: ${error.message}` };
  }
  const actual = sha256(parsed.body);
  return { ok: actual === parsed.sha256, expected: parsed.sha256, actual };
}

function snapshotSortKey(item) {
  return [item.prefix, String(item.rank).padStart(6, '0'), item.file].join('\u0000');
}

/**
 * All snapshots of a platform folder, oldest first. Order is the file name (which sorts by time), with
 * the collision counter (-2, -3) compared numerically so "-2" files come after the plain name.
 */
export function listSnapshots(platformDir) {
  const dir = path.join(platformDir, SNAPSHOT_DIR);
  if (!isDirectory(dir)) return [];
  const items = fs
    .readdirSync(dir)
    .filter((name) => SNAPSHOT_NAME_RE.test(name))
    .map((file) => {
      const full = path.join(dir, file);
      const text = readText(full);
      let parsed = null;
      let error = null;
      try {
        parsed = parseSnapshot(text);
      } catch (e) {
        error = e.message;
      }
      const prefix = file.slice(0, 15);
      const rest = file.slice(16, -4);
      const page = parsed?.page ?? rest;
      let rank = 1;
      const counter = new RegExp(`^${page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`).exec(rest);
      if (counter) rank = Number(counter[1]);
      return { file, path: full, prefix, page, rank, parsed, error, text };
    });
  return items.sort((a, b) => {
    const [ka, kb] = [snapshotSortKey(a), snapshotSortKey(b)];
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** Snapshots grouped by page: Map(page -> items oldest first), pages sorted by name. */
export function snapshotsByPage(platformDir) {
  const groups = new Map();
  for (const item of listSnapshots(platformDir)) {
    if (!groups.has(item.page)) groups.set(item.page, []);
    groups.get(item.page).push(item);
  }
  return new Map([...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The newest snapshot of every page (or of the named page only). */
export function latestSnapshots(platformDir, page) {
  const latest = [];
  for (const [name, items] of snapshotsByPage(platformDir)) {
    if (page === undefined || page === name) latest.push(items[items.length - 1]);
  }
  return latest;
}

// ------------------------------------------------------------------ platforms

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export { isDirectory, isFile };

function subdirectories(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('__') && !name.startsWith('.') && name !== 'node_modules' && name !== SNAPSHOT_DIR)
    .sort();
}

export function normalizeKey(key) {
  return String(key ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

/** True for a usable platform key: relative, no empty, dot or double-underscore segments, no reserved names. */
export function isValidPlatformKey(key) {
  const normalized = normalizeKey(key);
  if (normalized === '' || /^[a-zA-Z]:/.test(normalized)) return false;
  return normalized
    .split('/')
    .every(
      (segment) =>
        segment !== '' &&
        !segment.startsWith('.') &&
        !segment.startsWith('__') &&
        segment !== SNAPSHOT_DIR &&
        segment !== 'node_modules' &&
        !/[<>:"|?*\u0000-\u001f]/.test(segment),
    );
}

/** The platform keys listed in backticks under "## Registered" in PROFILES.md, with forward slashes. */
export function registeredKeys(root) {
  const file = path.join(root, REGISTRY_FILE);
  if (!isFile(file)) return [];
  const keys = [];
  let inRegistered = false;
  for (const line of readText(file).split(/\r?\n/)) {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) {
      inRegistered = /^Registered\b/.test(heading[1]);
      continue;
    }
    if (!inRegistered) continue;
    for (const match of line.matchAll(/`([^`]+)`/g)) keys.push(normalizeKey(match[1]));
  }
  return keys.filter(isValidPlatformKey);
}

/**
 * Platform folders under the root, at any depth: every folder holding CURRENT-STATE.md or a _SNAPSHOTS
 * folder, plus every existing folder listed under "## Registered" in PROFILES.md.
 * The category is the first folder of the key, or "None" for a platform directly under the root.
 * Returns [{key, dir, category, hasState, statePath}] sorted by key.
 */
export function listPlatforms(root) {
  const found = new Map();
  const add = (segments, hasState) => {
    const key = segments.join('/');
    const dir = path.join(root, ...segments);
    found.set(key, {
      key,
      dir,
      category: segments.length > 1 ? segments[0] : NO_CATEGORY,
      hasState,
      statePath: hasState ? path.join(dir, STATE_FILE) : null,
    });
  };
  const walk = (segments) => {
    const dir = path.join(root, ...segments);
    if (isFile(path.join(dir, STATE_FILE))) {
      add(segments, true);
      return;
    }
    if (isDirectory(path.join(dir, SNAPSHOT_DIR))) {
      add(segments, false);
      return;
    }
    for (const name of subdirectories(dir)) walk([...segments, name]);
  };
  if (!isDirectory(root)) return [];
  for (const name of subdirectories(root)) walk([name]);
  for (const key of registeredKeys(root)) {
    const hasDescendant = [...found.keys()].some((k) => k.startsWith(`${key}/`));
    if (!found.has(key) && !hasDescendant && isDirectory(path.join(root, ...key.split('/')))) add(key.split('/'), false);
  }
  return [...found.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The platform object for a key (either slash style), or null. */
export function resolvePlatform(root, key) {
  const wanted = normalizeKey(key);
  return listPlatforms(root).find((platform) => platform.key === wanted) ?? null;
}

// ------------------------------------------------------------------------ cli

/**
 * Minimal option parser. spec: {strings: [names taking a value], booleans: [flags], positionals: max count}.
 * Accepts "--name value" and "--name=value". Throws UsageError on anything else.
 */
export function parseArgs(argv, { strings = [], booleans = [], positionals = 0 } = {}) {
  const values = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      rest.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);
    if (booleans.includes(name)) {
      if (inline !== undefined) throw new UsageError(`Option --${name} does not take a value.`);
      values[name] = true;
    } else if (strings.includes(name)) {
      let value = inline;
      if (value === undefined) {
        value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) throw new UsageError(`Option --${name} needs a value.`);
        i += 1;
      }
      values[name] = value;
    } else {
      throw new UsageError(`Unknown option --${name}.`);
    }
  }
  if (rest.length > positionals) throw new UsageError(`Unexpected argument "${rest[positionals]}".`);
  return { values, positionals: rest };
}

/** The collection root: --root, else the EXTRACT_MY_PROFILE_ROOT variable, else ./profiles. */
export function resolveRoot(value, env = process.env) {
  const fromEnv = env[ROOT_ENV] !== undefined && env[ROOT_ENV].trim() !== '' ? env[ROOT_ENV] : undefined;
  return path.resolve(value ?? fromEnv ?? DEFAULT_ROOT_DIR);
}

export function write(text) {
  process.stdout.write(`${text}\n`);
}

export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  // Compare real paths: the skill runs through a junction, and Node resolves
  // import.meta.url through it but leaves process.argv[1] as typed.
  const real = (p) => {
    try {
      return fs.realpathSync.native(p).toLowerCase();
    } catch {
      return path.resolve(p).toLowerCase();
    }
  };
  return real(fileURLToPath(importMetaUrl)) === real(path.resolve(process.argv[1]));
}

/** Runs a CLI body and maps UsageError to exit code 2. The body returns its exit code. */
export async function runCli(body) {
  try {
    process.exitCode = await body();
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`Usage error: ${error.message}\n`);
    process.exitCode = EXIT.USAGE;
  }
}

// Template and registry checks for validate.mjs. Each returns findings as {platform, code, detail}.
import fs from 'node:fs';
import path from 'node:path';
import { SNAPSHOT_DIR, isDirectory, isFile, isValidDate, normalizeKey, readText, verifySnapshot } from './lib.mjs';

export const HEADER_KEYS = ['Last verified', 'Status', 'Owner', 'Profile URL', 'Category', 'Last snapshot'];
export const SECTIONS = ['What the platform is', 'Profile', 'Settings', 'Not read', 'Open', 'Change history'];

const HEADER_RE = new RegExp(`^(${HEADER_KEYS.join('|')}):[ \\t]*(.*?)[ \\t]*$`);

function isHttpUrl(value) {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

function isAscending(indexes) {
  return indexes.every((value, i) => i === 0 || indexes[i - 1] < value);
}

function parseHeaders(lines) {
  const firstSection = lines.findIndex((line) => /^## /.test(line));
  const region = lines.slice(1, firstSection === -1 ? lines.length : firstSection);
  const found = [];
  for (const line of region) {
    const match = HEADER_RE.exec(line);
    if (match) found.push({ key: match[1], value: match[2] });
  }
  return found;
}

function level2Headings(lines) {
  const headings = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = /^## (.*)$/.exec(line);
    if (match) headings.push(match[1].trimEnd());
  }
  return headings;
}

function checkLastSnapshot(platform, value, add) {
  if (value === 'None') return;
  const match = /^_SNAPSHOTS\/([^/\\]+)$/.exec(value);
  if (!match) {
    add('SNAPSHOT_MISSING', `"Last snapshot" must be None or _SNAPSHOTS/<file>, found "${value}"`);
    return;
  }
  const file = path.join(platform.dir, SNAPSHOT_DIR, match[1]);
  if (!isFile(file)) {
    add('SNAPSHOT_MISSING', `Snapshot file not found: _SNAPSHOTS/${match[1]}`);
    return;
  }
  const result = verifySnapshot(fs.readFileSync(file, 'utf8'));
  if (!result.ok) {
    add('SNAPSHOT_HASH', result.error ?? `_SNAPSHOTS/${match[1]}: body hash ${result.actual} does not match header ${result.expected}`);
  }
}

/** Template check for one platform with CURRENT-STATE.md. Returns {findings, lastVerified}. */
export function checkTemplate(platform) {
  const findings = [];
  const add = (code, detail) => findings.push({ platform: platform.key, code, detail });
  const lines = readText(platform.statePath).split(/\r?\n/);

  if (!/^# .+ profile, current state$/.test(lines[0] ?? '')) {
    add('TITLE', `Line 1 must read "# <name> profile, current state", found "${(lines[0] ?? '').slice(0, 80)}"`);
  }

  const headers = parseHeaders(lines);
  const first = new Map();
  for (const header of headers) if (!first.has(header.key)) first.set(header.key, header.value);
  for (const key of HEADER_KEYS) {
    const count = headers.filter((h) => h.key === key).length;
    if (count === 0) add('HEADER_MISSING', `Missing header "${key}:"`);
    else if (count > 1) add('HEADER_ORDER', `Header "${key}:" appears ${count} times`);
  }
  for (const key of ['Status', 'Owner']) {
    if (first.get(key) === '') add('HEADER_MISSING', `Header "${key}:" is empty`);
  }
  const order = [...first.keys()].map((key) => HEADER_KEYS.indexOf(key));
  if (!isAscending(order)) add('HEADER_ORDER', `Headers out of order, found ${[...first.keys()].join(', ')}`);

  const lastVerified = first.get('Last verified');
  if (lastVerified !== undefined && !isValidDate(lastVerified)) {
    add('BAD_DATE', `"Last verified" must be a real YYYY-MM-DD date, found "${lastVerified}"`);
  }
  const url = first.get('Profile URL');
  if (url !== undefined && !isHttpUrl(url)) add('BAD_URL', `"Profile URL" must be an http or https URL, found "${url}"`);
  const category = first.get('Category');
  if (category !== undefined && category !== platform.category) {
    add('CATEGORY_MISMATCH', `"Category" is "${category}" but the folder category is "${platform.category}"`);
  }
  const snapshot = first.get('Last snapshot');
  if (snapshot !== undefined) checkLastSnapshot(platform, snapshot, add);

  const headings = level2Headings(lines);
  const seen = new Set();
  const expectedOrder = [];
  for (const heading of headings) {
    const index = SECTIONS.indexOf(heading);
    if (index === -1) add('SECTION_EXTRA', `Unexpected section "## ${heading}"`);
    else if (seen.has(heading)) add('SECTION_EXTRA', `Section "## ${heading}" appears more than once`);
    else {
      seen.add(heading);
      expectedOrder.push(index);
    }
  }
  for (const section of SECTIONS) if (!seen.has(section)) add('SECTION_MISSING', `Missing section "## ${section}"`);
  if (!isAscending(expectedOrder)) {
    add('SECTION_ORDER', `Sections must appear as ${SECTIONS.map((s) => `"## ${s}"`).join(', ')}`);
  }
  return { findings, lastVerified };
}

function registrySections(text) {
  const sections = { Verified: [], Registered: [] };
  let current = null;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) {
      current = /^Verified\b/.test(heading[1]) ? 'Verified' : /^Registered\b/.test(heading[1]) ? 'Registered' : null;
      continue;
    }
    if (current) sections[current].push(line);
  }
  return sections;
}

function linkTargets(line) {
  const targets = [];
  for (const match of line.matchAll(/\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\s*\)/g)) {
    let target = match[1].replace(/^<|>$/g, '');
    try {
      target = decodeURIComponent(target);
    } catch {
      // keep the raw target when it is not valid percent-encoding
    }
    targets.push(target.replace(/\\/g, '/').replace(/^\.\//, ''));
  }
  return targets;
}

/**
 * Registry check against PROFILES.md. platforms: [{platform, lastVerified}] for every platform in scope.
 * registryPath may be missing, which gives one collection-level finding.
 */
export function checkRegistry(registryPath, platforms) {
  if (!isFile(registryPath)) {
    return [{ platform: '(collection)', code: 'REGISTRY_MISSING', detail: `Registry not found: ${registryPath}` }];
  }
  const findings = [];
  const { Verified: verified, Registered: registered } = registrySections(readText(registryPath));
  const registeredPaths = new Set(
    registered.flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((m) => normalizeKey(m[1]))),
  );
  const root = path.dirname(registryPath);
  for (const key of registeredPaths) {
    if (!isDirectory(path.join(root, ...key.split('/')))) {
      findings.push({ platform: '(collection)', code: 'REGISTRY_PATH_MISSING', detail: `Registered folder not found: ${key}` });
    }
  }
  for (const { platform, lastVerified } of platforms) {
    const add = (code, detail) => findings.push({ platform: platform.key, code, detail });
    if (!platform.hasState) {
      if (!registeredPaths.has(platform.key)) {
        add('REGISTRY_UNLISTED_EMPTY', `No \`${platform.key}\` entry under "## Registered" and no CURRENT-STATE.md`);
      }
      continue;
    }
    const wanted = `${platform.key}/CURRENT-STATE.md`;
    const line = verified.find((candidate) => linkTargets(candidate).includes(wanted));
    if (line === undefined) {
      add('REGISTRY_MISSING', `No line under "## Verified" links to ${wanted}`);
      continue;
    }
    const date = /verified (\d{4}-\d{2}-\d{2})/i.exec(line)?.[1];
    if (date === undefined) add('REGISTRY_DATE', 'Registry line has no "verified YYYY-MM-DD"');
    else if (lastVerified !== undefined && date !== lastVerified) {
      add('REGISTRY_DATE', `Registry says verified ${date}, CURRENT-STATE.md says ${lastVerified}`);
    }
  }
  return findings;
}

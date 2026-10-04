// Sidecar loading, text-source resolution and matching, shared by check-approved.mjs and validate.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { normalizeForMatch, normalizeKey, readText } from './lib.mjs';

export const SIDECAR_SCHEMA_ID = 'approved-profile-texts-v1';
export const MIN_OVERLAP = 0.6;

/** Link syntax reduced to its label, bold markers removed. */
export function stripMarkdownInline(text) {
  return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '');
}

/**
 * The text under an exact heading line up to the next heading of the same or higher level.
 * Returns null when the heading is not found or the section is empty.
 */
export function extractResumeSection(markdown, heading) {
  const wanted = String(heading).trim();
  const level = /^(#{1,6})\s/.exec(wanted)?.[1].length;
  if (!level) return null;
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
  let inFence = false;
  let startIndex = -1;
  let endIndex = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    if (startIndex === -1) {
      if (line.trim() === wanted) startIndex = i;
      continue;
    }
    const match = /^(#{1,6})\s/.exec(line);
    if (match && match[1].length <= level) {
      endIndex = i;
      break;
    }
  }
  if (startIndex === -1) return null;
  // Horizontal rules are layout, not text, and list markers are dropped because profiles show the
  // bullet text as running sentences.
  const body = lines
    .slice(startIndex + 1, endIndex)
    .filter((line) => !/^\s*([-*_])(\s*\1){2,}\s*$/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, ''));
  while (body.length > 0 && body[0].trim() === '') body.shift();
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  if (body.length === 0) return null;
  return stripMarkdownInline(body.join('\n'));
}

/** Problems in one sidecar entry, as readable strings. Empty means the entry is usable. */
export function entryProblems(entry, index) {
  const label = `texts[${index}]`;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [`${label} is not an object`];
  const problems = [];
  if (typeof entry.id !== 'string' || entry.id.trim() === '') problems.push(`${label} needs a non-empty "id"`);
  const type = entry.source?.type;
  if (type === 'inline') {
    if (typeof entry.text !== 'string' || normalizeForMatch(entry.text) === '') {
      problems.push(`${label} (inline) needs a non-empty "text"`);
    }
  } else if (type === 'resume-section') {
    if (typeof entry.source.file !== 'string' || entry.source.file === '') problems.push(`${label} needs source.file`);
    if (typeof entry.source.heading !== 'string' || entry.source.heading === '') {
      problems.push(`${label} needs source.heading`);
    }
  } else {
    problems.push(`${label} source.type must be "inline" or "resume-section"`);
  }
  if (!Array.isArray(entry.platforms) || entry.platforms.length === 0 || entry.platforms.some((p) => typeof p !== 'string')) {
    problems.push(`${label} needs a non-empty "platforms" array of strings`);
  }
  return problems;
}

/**
 * Reads the sidecar. Returns {state, ...}:
 *  state "missing": file not found. state "invalid": {problems}. state "ok": {data, entries, problemsByIndex}.
 * Structurally broken entries are listed in problems and left out of entries.
 */
export function loadSidecar(sidecarPath) {
  if (!fs.existsSync(sidecarPath)) return { state: 'missing', problems: [`Sidecar not found: ${sidecarPath}`] };
  let data;
  try {
    data = JSON.parse(readText(sidecarPath));
  } catch (error) {
    return { state: 'invalid', problems: [`Sidecar is not valid JSON: ${error.message}`] };
  }
  const problems = [];
  if (data === null || typeof data !== 'object' || data.schema !== SIDECAR_SCHEMA_ID) {
    problems.push(`"schema" must be "${SIDECAR_SCHEMA_ID}"`);
  }
  if (!Array.isArray(data?.texts)) {
    problems.push('"texts" must be an array');
    return { state: 'invalid', problems };
  }
  const entries = [];
  data.texts.forEach((entry, index) => {
    const found = entryProblems(entry, index);
    if (found.length > 0) problems.push(...found);
    else entries.push({ ...entry, platforms: entry.platforms.map(normalizeKey) });
  });
  return { state: problems.length > 0 ? 'invalid' : 'ok', problems, entries };
}

/** The approved text of an entry: {ok:true, text} or {ok:false, detail}. */
export function resolveSource(entry, sidecarPath) {
  if (entry.source.type === 'inline') return { ok: true, text: entry.text };
  const file = path.resolve(path.dirname(sidecarPath), entry.source.file);
  if (!fs.existsSync(file)) return { ok: false, detail: `resume file not found: ${file}` };
  const text = extractResumeSection(readText(file), entry.source.heading);
  if (text === null) return { ok: false, detail: `heading "${entry.source.heading}" not found or empty in ${file}` };
  return { ok: true, text };
}

function wordSet(text) {
  const words = normalizeForMatch(text)
    .toLowerCase()
    .split(' ')
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
  return new Set(words);
}

/**
 * Compares an approved text with the latest snapshots of a platform.
 * Returns {status: present|differs|missing, closest, similarity, page}.
 */
export function classifyText(text, snapshots) {
  const needle = normalizeForMatch(text);
  const needleWords = wordSet(text);
  let best = { similarity: 0, closest: '', page: null };
  for (const snapshot of snapshots) {
    const body = snapshot.parsed.body;
    if (needle !== '' && normalizeForMatch(body).includes(needle)) {
      return { status: 'present', closest: '', similarity: 1, page: snapshot.page };
    }
    for (const line of body.split('\n')) {
      const normalized = normalizeForMatch(line);
      if (normalized === '' || needleWords.size === 0) continue;
      const lineWords = wordSet(normalized);
      let shared = 0;
      for (const word of needleWords) if (lineWords.has(word)) shared += 1;
      const similarity = shared / needleWords.size;
      if (similarity > best.similarity) best = { similarity, closest: normalized, page: snapshot.page };
    }
  }
  if (best.similarity >= MIN_OVERLAP) return { status: 'differs', ...best };
  return { status: 'missing', closest: '', similarity: best.similarity, page: null };
}

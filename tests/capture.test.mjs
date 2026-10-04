import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { normalizeBody, parseSnapshot, resolvePlatform, sha256 } from '../scripts/lib.mjs';
import { BETA, SCRIPTS, copyFixture, run, tempDir } from './helpers.mjs';

const CAPTURE_SOURCE = await readFile(join(SCRIPTS, 'browser-capture.js'), 'utf8');

/**
 * Runs browser-capture.js as the browser would, against a fake document whose `selector` element holds
 * `innerText`. Returns the page result plus `sha256`, the fingerprint without spaces, and `text`, the
 * normalized copy an agent would save (what get_page_text returns for that element).
 */
async function captureInBrowser(innerText, selector = 'main') {
  const document = { querySelector: (s) => (s === selector ? { innerText } : null) };
  const context = vm.createContext({ document, crypto: globalThis.crypto, TextEncoder });
  const capture = vm.runInContext(`(${CAPTURE_SOURCE})`, context);
  const result = await capture(selector, 'innertext', 0);
  return { ...result, sha256: result.fingerprint.replace(/ /g, ''), text: normalizeBody(innerText) };
}

/** A fake page whose text grows on the first reads, like a list that loads after the page shell. */
function loadingPage(states) {
  let reads = 0;
  const element = {
    get innerText() {
      const text = states[Math.min(reads, states.length - 1)];
      reads += 1;
      return text;
    },
  };
  const document = { querySelector: () => element };
  const context = vm.createContext({ document, crypto: globalThis.crypto, TextEncoder, setTimeout });
  return vm.runInContext(`(${CAPTURE_SOURCE})`, context);
}

test('the capture waits until late content has loaded before it fingerprints', async () => {
  const final = 'Websites\nhttps://portfolio.example.test\n';
  const capture = loadingPage(['Websites\nAdd\n', 'Websites\nAdd\n', final]);
  const result = await capture('main', 'innertext', 10);
  assert.equal(result.settled, true);
  assert.equal(result.fingerprint.replace(/ /g, ''), sha256(normalizeBody(final)));
});

test('a page that never stops changing is reported as not settled', async () => {
  const states = Array.from({ length: 40 }, (_, i) => `Counter ${i}\n`);
  const result = await loadingPage(states)('main', 'innertext', 1);
  assert.equal(result.settled, false);
});

const SAMPLES = [
  'Plain text',
  'Hello  \r\nWorld\r\n\r\n',
  '\n\n  leading blank lines\n\ttabs at end\t\t\n\n',
  'Non\u00A0breaking\u00A0spaces and zero\u200Bwidth\uFEFF marks',
  'Ümlaut, 日本語, emoji 🎉 and ⦿ bullets \u2014 dashes “quotes”',
  'Trailing spaces   \nInner  double  spaces stay\n',
  '',
  '\n \n\t\n',
];

test('browser capture normalizes and fingerprints exactly like lib.mjs', async () => {
  for (const sample of SAMPLES) {
    const result = await captureInBrowser(sample);
    const expected = normalizeBody(sample);
    assert.equal(result.sha256, sha256(expected), `hash differs for ${JSON.stringify(sample)}`);
    assert.equal(result.chars, expected.length);
  }
});

async function setup(t, text) {
  const root = await copyFixture(t);
  const input = join(await tempDir(t), 'copy.txt');
  await writeFile(input, text);
  return { root, input };
}

function save(root, input, extra = []) {
  return run('snapshot.mjs', ['save', '--root', root, '--platform', BETA, '--page', 'home', '--url', 'https://beta.example.test/me', '--input', input, '--now', '2026-10-03T12:05:00-04:00', ...extra]);
}

test('a copy matching the page fingerprint is saved and the check is recorded', async (t) => {
  const page = 'Profile\u00A0page\nHeadline: Designer  \n';
  const { sha256: pageHash, text } = await captureInBrowser(page);
  const { root, input } = await setup(t, text);
  const { fingerprint } = await captureInBrowser(page);
  const result = save(root, input, ['--expect-sha256', fingerprint]);
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.capture_check, `browser-sha256 ${pageHash}`);
  const dir = join(resolvePlatform(root, BETA).dir, '_SNAPSHOTS');
  const parsed = parseSnapshot(await readFile(join(dir, out.file), 'utf8'));
  assert.equal(parsed.sha256, pageHash);
});

test('a copy that differs from the page fingerprint is refused and nothing is written', async (t) => {
  const { sha256: pageHash } = await captureInBrowser('Headline: Product Designer\n');
  const { root, input } = await setup(t, 'Headline: Product Desinger\n');
  const result = save(root, input, ['--expect-sha256', pageHash]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match the page fingerprint/);
  const dir = join(resolvePlatform(root, BETA).dir, '_SNAPSHOTS');
  const files = await readdir(dir).catch(() => []);
  assert.equal(files.length, 0);
});

test('a malformed fingerprint is a usage error', async (t) => {
  const { root, input } = await setup(t, 'text\n');
  assert.equal(save(root, input, ['--expect-sha256', 'abc']).status, 2);
});

test('a save without a fingerprint records capture_check none', async (t) => {
  const { root, input } = await setup(t, 'text\n');
  const result = save(root, input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).capture_check, 'none');
});

test('the fingerprint is eight groups of eight hex characters', async () => {
  const result = await captureInBrowser('Some page');
  assert.match(result.fingerprint, /^([0-9a-f]{8} ){7}[0-9a-f]{8}$/);
  assert.equal(result.source, 'main');
});

test('a missing source element is reported, not fingerprinted', async () => {
  const document = { querySelector: () => null };
  const context = vm.createContext({ document, crypto: globalThis.crypto, TextEncoder });
  const capture = vm.runInContext(`(${CAPTURE_SOURCE})`, context);
  const result = await capture('article');
  assert.match(result.error, /No element matches article/);
});
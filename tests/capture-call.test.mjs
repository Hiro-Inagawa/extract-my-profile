import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { normalizeBody } from '../scripts/lib.mjs';
import { SCRIPTS, run, tempDir } from './helpers.mjs';

const SOURCE = await readFile(join(SCRIPTS, 'browser-capture.js'), 'utf8');
const SOURCE_LINES = SOURCE.split(/\r?\n/);
const FUNCTION_START = SOURCE_LINES.findIndex((line) => line.startsWith('async ('));
const HEADER = SOURCE_LINES.slice(0, FUNCTION_START).filter((line) => line.startsWith('//'));

test('the default call fingerprints main in innertext mode', () => {
  const result = run('capture-call.mjs', []);
  assert.equal(result.status, 0, result.stderr);
  const text = result.stdout.trimEnd();
  assert.ok(text.startsWith('await (async'));
  assert.ok(text.endsWith(")('main')"));
});

test('composed mode and a custom selector end with the matching call', () => {
  const result = run('capture-call.mjs', ['article.profile', 'composed']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trimEnd().endsWith(")('article.profile', 'composed')"));
});

test('the header comment block is removed and the function is kept whole', () => {
  const { stdout } = run('capture-call.mjs', []);
  const lines = stdout.split('\n');
  assert.ok(HEADER.length > 5);
  for (const line of HEADER) assert.ok(!lines.includes(line), `header line present: ${line}`);
  assert.ok(!lines.some((line) => line.startsWith('// Page fingerprint')));
  assert.ok(stdout.includes(SOURCE_LINES.slice(FUNCTION_START).join('\n').trim()));
});

test('the printed text runs as the browser would run it', async () => {
  const { stdout } = run('capture-call.mjs', []);
  const document = { querySelector: (s) => (s === 'main' ? { innerText: 'Headline\n\nBody  text\n' } : null) };
  const context = vm.createContext({ document, crypto: globalThis.crypto, TextEncoder, setTimeout });
  const result = await vm.runInContext(`(async () => ${stdout.trim()})()`, context);
  assert.equal(result.source, 'main');
  assert.equal(result.mode, 'innertext');
  assert.equal(result.chars, normalizeBody('Headline\n\nBody  text\n').length);
});

test('a bad mode, a quote or backslash in the selector, an empty selector or an extra argument exits 2', () => {
  const quote = String.fromCharCode(39);
  const backslash = String.fromCharCode(92);
  const cases = [['main', 'html'], [`a${quote}b`], [`a${backslash}b`], [''], ['main', 'innertext', 'extra']];
  for (const args of cases) {
    const result = run('capture-call.mjs', args);
    assert.equal(result.status, 2, `args ${JSON.stringify(args)}`);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.length > 0);
  }
});

test('the approved-text format documented in the README reports present', async (t) => {
  const dir = await tempDir(t);
  const root = join(dir, 'profiles');
  assert.equal(run('init.mjs', ['--root', root]).status, 0);
  const scratch = join(dir, 'page.txt');
  await writeFile(scratch, 'Demo\n\nSenior product designer for data tools\nHourly rate: $95\n');
  const saved = run('snapshot.mjs', ['save', '--root', root, '--create', '--platform', 'demo-platform', '--page', 'profile', '--url', 'http://127.0.0.1:4173/demo-platform/profile-v2.html', '--input', scratch]);
  assert.equal(saved.status, 0, saved.stderr);
  const entry = { id: 'headline', source: { type: 'inline' }, text: 'Senior product designer for data tools', platforms: ['demo-platform'] };
  await writeFile(join(root, 'APPROVED-PROFILE-TEXTS.json'), `${JSON.stringify({ schema: 'approved-profile-texts-v1', texts: [entry] }, null, 2)}\n`);
  const checked = run('check-approved.mjs', ['--root', root]);
  assert.equal(checked.status, 0, checked.stdout);
  assert.match(checked.stdout, /\| headline \| demo-platform \| present \|/);
});

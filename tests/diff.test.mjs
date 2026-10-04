import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { resolvePlatform } from '../scripts/lib.mjs';
import { diffLines, renderHunks } from '../scripts/diff.mjs';
import { saveSnapshot } from '../scripts/snapshot.mjs';
import { ALPHA, BETA, copyFixture, run, tempDir } from './helpers.mjs';

async function saveBody(t, root, platform, page, body, now) {
  const input = join(await tempDir(t), 'in.txt');
  await writeFile(input, body);
  return saveSnapshot({ root, platform, page, url: 'https://beta.example.test/me', input, now });
}

test('diff reports the changed lines with one line of context, as a child process', async (t) => {
  const root = await copyFixture(t);
  const result = run('diff.mjs', ['--root', root, '--platform', ALPHA, '--page', 'profile']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      '### profile: 2026-10-01-0900-profile.txt -> 2026-10-02-1000-profile.txt',
      '```diff',
      '  Fixture Alpha profile page',
      '- Headline: Product designer for AI platforms',
      '+ Headline: Senior product designer for AI platforms',
      '  About',
      '  I am a product designer who builds design systems for fictional teams.',
      '- Rate: $90/hr',
      '+ Skills: Figma, Prototyping, Research',
      '+ Rate: $100/hr',
      '```',
      '',
    ].join('\n'),
  );
});

test('diff without --page lists every page and says when a page has only one snapshot', async (t) => {
  const root = await copyFixture(t);
  const result = run('diff.mjs', ['--root', root, '--platform', ALPHA]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^### profile: .*\n```diff\n/);
  assert.match(result.stdout, /\n\nOnly one snapshot for settings\.\n$/);
});

test('diff prints No change. when the two latest snapshots have the same body', async (t) => {
  const root = await copyFixture(t);
  await saveBody(t, root, BETA, 'home', 'Same\ntext\n', '2026-10-03T09:00:00-04:00');
  await saveBody(t, root, BETA, 'home', 'Same  \r\ntext\r\n', '2026-10-03T10:00:00-04:00');
  const result = run('diff.mjs', ['--root', root, '--platform', BETA]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '### home: 2026-10-03-0900-home.txt -> 2026-10-03-1000-home.txt\nNo change.\n');
});

test('diff compares the two latest snapshots only', async (t) => {
  const root = await copyFixture(t);
  await saveBody(t, root, BETA, 'home', 'v1\n', '2026-10-03T09:00:00-04:00');
  await saveBody(t, root, BETA, 'home', 'v2\n', '2026-10-03T10:00:00-04:00');
  await saveBody(t, root, BETA, 'home', 'v3\n', '2026-10-03T11:00:00-04:00');
  const result = run('diff.mjs', ['--root', root, '--platform', BETA, '--page', 'home']);
  assert.match(result.stdout, /2026-10-03-1000-home\.txt -> 2026-10-03-1100-home\.txt/);
  assert.match(result.stdout, /- v2\n\+ v3/);
});

test('diff exits 1 when a snapshot fails hash verification', async (t) => {
  const root = await copyFixture(t);
  const alpha = resolvePlatform(root, ALPHA);
  const file = join(alpha.dir, '_SNAPSHOTS', '2026-10-02-1000-profile.txt');
  await writeFile(file, (await readFile(file, 'utf8')).replace('100/hr', () => '999/hr'));
  const result = run('diff.mjs', ['--root', root, '--platform', ALPHA, '--page', 'profile']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Verification failed/);
});

test('diff exits 2 for an unknown platform and prints a note for an empty one', async (t) => {
  const root = await copyFixture(t);
  assert.equal(run('diff.mjs', ['--root', root, '--platform', 'contract/nope']).status, 2);
  assert.equal(run('diff.mjs', ['--root', root]).status, 2);
  const empty = run('diff.mjs', ['--root', root, '--platform', BETA]);
  assert.equal(empty.status, 0);
  assert.equal(empty.stdout, 'No snapshots.\n');
});

test('diffLines finds a minimal line diff and renderHunks limits context to one line', () => {
  const oldLines = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const newLines = ['a', 'b', 'C', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
  const ops = diffLines(oldLines, newLines);
  assert.equal(ops.filter((entry) => entry.op === '-').length, 1);
  assert.equal(ops.filter((entry) => entry.op === '+').length, 2);
  assert.deepEqual(renderHunks(ops), ['  b', '- c', '+ C', '  d', '  j', '+ k']);
});

test('diffLines handles moved and repeated lines without losing any', () => {
  const oldLines = ['x', 'y', 'x', 'z'];
  const newLines = ['z', 'x', 'y', 'x'];
  const ops = diffLines(oldLines, newLines);
  assert.deepEqual(ops.filter((entry) => entry.op !== '+').map((entry) => entry.line), oldLines);
  assert.deepEqual(ops.filter((entry) => entry.op !== '-').map((entry) => entry.line), newLines);
});

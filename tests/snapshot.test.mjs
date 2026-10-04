import assert from 'node:assert/strict';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { parseSnapshot, resolvePlatform, sha256, verifySnapshot } from '../scripts/lib.mjs';
import { saveSnapshot } from '../scripts/snapshot.mjs';
import { BETA, GAMMA, copyFixture, run, tempDir } from './helpers.mjs';

const URL = 'https://beta.example.test/me';

async function inputFile(t, text) {
  const file = join(await tempDir(t), 'input.txt');
  await writeFile(file, text);
  return file;
}

function save(root, input, now, extra = []) {
  return run('snapshot.mjs', ['save', '--root', root, '--platform', BETA, '--page', 'home', '--url', URL, '--input', input, '--now', now, ...extra]);
}

test('save writes a verified snapshot named from the capture time, as a child process', async (t) => {
  const root = await copyFixture(t);
  const input = await inputFile(t, 'Hello  \r\nWorld\r\n\r\n');
  const result = save(root, input, '2026-10-03T12:05:00-04:00');
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout.trim());
  assert.deepEqual(out, { file: '2026-10-03-1205-home.txt', sha256: sha256('Hello\nWorld\n'), previous: null, status: 'new', capture_check: 'none' });

  const text = await readFile(join(root, ...BETA.split('/'), '_SNAPSHOTS', out.file), 'utf8');
  assert.equal(text, `url: ${URL}\ncaptured_at: 2026-10-03T12:05:00-04:00\npage: home\nsha256: ${out.sha256}\ncapture_check: none\ntool: extract-my-profile/snapshot.mjs\n---\nHello\nWorld\n`);
  assert.equal(verifySnapshot(text).ok, true);
});

test('save reports unchanged, changed and handles a name collision in the same minute', async (t) => {
  const root = await copyFixture(t);
  const first = JSON.parse(save(root, await inputFile(t, 'same text\n'), '2026-10-03T12:05:10-04:00').stdout);
  assert.equal(first.status, 'new');

  const second = JSON.parse(save(root, await inputFile(t, 'same text   \r\n\r\n'), '2026-10-03T12:05:50-04:00').stdout);
  assert.equal(second.status, 'unchanged');
  assert.equal(second.file, '2026-10-03-1205-home-2.txt');
  assert.equal(second.previous, first.file);

  const third = JSON.parse(save(root, await inputFile(t, 'same text\n'), '2026-10-03T12:05:55-04:00').stdout);
  assert.equal(third.file, '2026-10-03-1205-home-3.txt');
  assert.equal(third.previous, second.file);

  const fourth = JSON.parse(save(root, await inputFile(t, 'different text\n'), '2026-10-03T13:00:00-04:00').stdout);
  assert.equal(fourth.status, 'changed');
  assert.equal(fourth.previous, third.file);

  const files = await readdir(join(root, ...BETA.split('/'), '_SNAPSHOTS'));
  assert.equal(files.length, 4);
});

test('status compares only snapshots of the same page', async (t) => {
  const root = await copyFixture(t);
  const input = await inputFile(t, 'shared body\n');
  saveSnapshot({ root, platform: BETA, page: 'home', url: URL, input, now: '2026-10-03T09:00:00-04:00' });
  const other = saveSnapshot({ root, platform: BETA, page: 'about', url: URL, input, now: '2026-10-03T09:01:00-04:00' });
  assert.equal(other.status, 'new');
  assert.equal(other.previous, null);
});

test('save accepts a backslash platform key and creates _SNAPSHOTS when it is missing', async (t) => {
  const root = await copyFixture(t);
  const result = saveSnapshot({
    root,
    platform: 'social media\\gamma\\profile',
    page: 'profile',
    url: 'https://gamma.example.test/in/x',
    input: await inputFile(t, 'text\n'),
    now: '2026-10-03T08:30:00+02:00',
  });
  assert.equal(result.file, '2026-10-03-0830-profile.txt');
  const gamma = resolvePlatform(root, GAMMA);
  const parsed = parseSnapshot(await readFile(join(gamma.dir, '_SNAPSHOTS', result.file), 'utf8'));
  assert.equal(parsed.captured_at, '2026-10-03T08:30:00+02:00');
});

test('save exits 2 for empty input and writes nothing', async (t) => {
  const root = await copyFixture(t);
  const result = save(root, await inputFile(t, '  \r\n\t\n'), '2026-10-03T12:05:00-04:00');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /empty/i);
  await assert.rejects(access(join(root, ...BETA.split('/'), '_SNAPSHOTS')));
});

test('save exits 2 for an unknown platform, a content folder, a bad page, a bad time and missing options', async (t) => {
  const root = await copyFixture(t);
  const input = await inputFile(t, 'text\n');
  const base = ['save', '--root', root, '--url', URL, '--input', input, '--now', '2026-10-03T12:05:00-04:00'];
  const exits = (args) => run('snapshot.mjs', args).status;
  assert.equal(exits([...base, '--platform', 'contract/nope', '--page', 'home']), 2);
  assert.equal(exits([...base, '--platform', 'social media/reddit', '--page', 'home']), 2);
  assert.equal(exits([...base, '--platform', BETA, '--page', 'Home Page']), 2);
  assert.equal(exits(['save', '--root', root, '--platform', BETA, '--page', 'home', '--url', URL, '--input', input, '--now', 'yesterday']), 2);
  assert.equal(exits(['save', '--root', root, '--platform', BETA, '--page', 'home']), 2);
  assert.equal(exits(['--root', root]), 2);
  assert.equal(exits([...base, '--platform', BETA, '--page', 'home', '--input', join(root, 'missing.txt')]), 2);
});

test('--create makes a new platform folder, a repeat run finds it, and unusable keys are refused', async (t) => {
  const root = await copyFixture(t);
  const input = await inputFile(t, 'text\n');
  const args = (key, extra = []) => ['save', '--root', root, '--platform', key, '--page', 'home', '--url', URL, '--input', input, '--now', '2026-10-03T12:05:00-04:00', ...extra];
  assert.equal(run('snapshot.mjs', args('newplace/deep key')).status, 2);
  const created = run('snapshot.mjs', args('newplace/deep key', ['--create']));
  assert.equal(created.status, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).status, 'new');
  await access(join(root, 'newplace', 'deep key', '_SNAPSHOTS', '2026-10-03-1205-home.txt'));
  assert.equal(resolvePlatform(root, 'newplace/deep key')?.hasState, false);
  const again = run('snapshot.mjs', args('newplace/deep key', ['--create', '--now', '2026-10-03T12:09:00-04:00']));
  assert.equal(JSON.parse(again.stdout).status, 'unchanged');
  for (const bad of ['../outside', 'a/../../b', '__hidden', 'a/_SNAPSHOTS', 'C:\\temp\\x', '.git']) {
    assert.equal(run('snapshot.mjs', args(bad, ['--create'])).status, 2, bad);
  }
  await assert.rejects(access(join(root, '..', 'outside')));
});

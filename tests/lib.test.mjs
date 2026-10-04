import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path, { join } from 'node:path';
import test from 'node:test';
import {
  DEFAULT_ROOT_DIR,
  ROOT_ENV,
  UsageError,
  formatSnapshot,
  isValidPlatformKey,
  latestSnapshots,
  listPlatforms,
  normalizeBody,
  normalizeForMatch,
  parseArgs,
  parseRfc3339,
  parseSnapshot,
  registeredKeys,
  resolvePlatform,
  resolveRoot,
  sha256,
  verifySnapshot,
} from '../scripts/lib.mjs';
import { ALPHA, BETA, FIXTURE, GAMMA, copyFixture } from './helpers.mjs';

test('normalizeBody converts line endings, trims blanks at both line ends, collapses inner runs and trims outer blank lines', () => {
  // Matches get_page_text, which drops leading spaces and collapses repeated spaces inside a line.
  const messy = '\r\n\r\n  indented  line  \t\r\nsecond line   \r\n\r\nafter gap\r\r\n\r\n';
  assert.equal(normalizeBody(messy), 'indented line\nsecond line\n\nafter gap\n');
  assert.equal(normalizeBody('a\r\nb'), 'a\nb\n');
  assert.equal(normalizeBody('a\rb\n\n\n'), 'a\nb\n');
});

test('normalizeBody keeps every visible character and is idempotent', () => {
  const text = '  Café “quoted” \u2014 dash\n\n\tTabbed start\nlast';
  const once = normalizeBody(text);
  assert.equal(once, 'Café “quoted” \u2014 dash\n\nTabbed start\nlast\n');
  assert.equal(normalizeBody(once), once);
  assert.equal(normalizeBody('   \n\t\n'), '');
});

test('sha256 is deterministic and CRLF or trailing-space variants hash alike after normalization', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const lf = normalizeBody('one\ntwo\n');
  const crlf = normalizeBody('one  \r\ntwo \t\r\n\r\n');
  assert.equal(sha256(lf), sha256(crlf));
  assert.notEqual(sha256(lf), sha256(normalizeBody('one\ntwo!\n')));
});

test('normalizeForMatch maps quotes and dashes, collapses whitespace and keeps case', () => {
  assert.equal(normalizeForMatch('  It’s “fine” – really\u2014truly\n\n  Done  '), 'It\'s "fine" - really-truly Done');
  assert.equal(normalizeForMatch('Mixed CASE'), 'Mixed CASE');
  assert.equal(normalizeForMatch('‘single’'), "'single'");
});

test('formatSnapshot and parseSnapshot round trip and verifySnapshot catches edits', () => {
  const text = formatSnapshot({
    url: 'https://x.example.test/p',
    captured_at: '2026-10-03T12:05:00-04:00',
    page: 'profile',
    body: 'Line one  \r\nLine two\r\n',
  });
  assert.match(text, /^url: https:\/\/x\.example\.test\/p\ncaptured_at: 2026-10-03T12:05:00-04:00\npage: profile\nsha256: [0-9a-f]{64}\ncapture_check: none\ntool: extract-my-profile\/snapshot\.mjs\n---\nLine one\nLine two\n$/);
  const parsed = parseSnapshot(text);
  assert.deepEqual(
    { url: parsed.url, captured_at: parsed.captured_at, page: parsed.page, body: parsed.body },
    { url: 'https://x.example.test/p', captured_at: '2026-10-03T12:05:00-04:00', page: 'profile', body: 'Line one\nLine two\n' },
  );
  assert.equal(parsed.sha256, sha256('Line one\nLine two\n'));
  assert.equal(verifySnapshot(text).ok, true);
  const tampered = verifySnapshot(text.replace('Line two', 'Line 2'));
  assert.equal(tampered.ok, false);
  assert.notEqual(tampered.expected, tampered.actual);
  assert.equal(verifySnapshot('no separator here').ok, false);
});

test('parseRfc3339 accepts offsets and rejects impossible dates', () => {
  assert.deepEqual(parseRfc3339('2026-10-03T12:05:00-04:00'), { date: '2026-10-03', hhmm: '1205' });
  assert.deepEqual(parseRfc3339('2026-10-03T00:00:00Z'), { date: '2026-10-03', hhmm: '0000' });
  assert.equal(parseRfc3339('2026-02-30T12:00:00Z'), null);
  assert.equal(parseRfc3339('2026-10-03 12:00'), null);
  assert.equal(parseRfc3339('2026-10-03T25:00:00Z'), null);
});

test('listPlatforms finds state folders and empty registered folders and ignores content folders', () => {
  const keys = listPlatforms(FIXTURE).map((platform) => platform.key);
  assert.deepEqual(keys, [ALPHA, BETA, GAMMA]);
  const byKey = Object.fromEntries(listPlatforms(FIXTURE).map((platform) => [platform.key, platform]));
  assert.equal(byKey[ALPHA].hasState, true);
  assert.equal(byKey[BETA].hasState, false);
  assert.equal(byKey[GAMMA].category, 'social media');
  assert.ok(!keys.some((key) => key.includes('reddit')));
  assert.ok(!keys.some((key) => key.includes('__sources')));
});

test('listPlatforms skips double-underscore folders and anything under _SNAPSHOTS', async (t) => {
  const root = await copyFixture(t);
  for (const dir of ['contract/__archive', 'contract/alpha/_SNAPSHOTS/_OLD', 'employers/__hidden', 'contract/.cache', 'node_modules/pkg']) {
    await mkdir(join(root, ...dir.split('/')), { recursive: true });
    await writeFile(join(root, ...dir.split('/'), 'CURRENT-STATE.md'), '# x profile, current state\n');
  }
  assert.deepEqual(listPlatforms(root).map((platform) => platform.key), [ALPHA, BETA, GAMMA]);
});

test('an empty folder is a platform only when PROFILES.md registers it, a _SNAPSHOTS folder also makes one', async (t) => {
  const root = await copyFixture(t);
  await mkdir(join(root, 'employers', 'delta'), { recursive: true });
  await mkdir(join(root, 'notes', 'scratch'), { recursive: true });
  assert.ok(!listPlatforms(root).some((platform) => platform.key === 'employers/delta'));
  const registry = join(root, 'PROFILES.md');
  await writeFile(registry, `${await readFile(registry, 'utf8')}- \`employers\\delta\`, no profile yet\n`);
  const delta = listPlatforms(root).find((platform) => platform.key === 'employers/delta');
  assert.equal(delta?.hasState, false);
  assert.equal(delta?.category, 'employers');
  assert.ok(!listPlatforms(root).some((platform) => platform.key.includes('scratch')));
  await mkdir(join(root, 'standalone', '_SNAPSHOTS'), { recursive: true });
  const standalone = listPlatforms(root).find((platform) => platform.key === 'standalone');
  assert.equal(standalone?.hasState, false);
  assert.equal(standalone?.category, 'None');
});

test('registeredKeys reads backtick paths under Registered only, in either slash style', async (t) => {
  const root = await copyFixture(t);
  const registry = join(root, 'PROFILES.md');
  await writeFile(registry, '## Verified\n\n- [A](a/CURRENT-STATE.md), `not/this`\n\n## Registered\n\n- `x\\y`, one\n- `../escape`, bad\n- `z/`, two\n');
  assert.deepEqual(registeredKeys(root), ['x/y', 'z']);
});

test('isValidPlatformKey accepts nested relative keys and rejects traversal, absolute and reserved names', () => {
  for (const ok of ['linkedin', 'contract/aquent', 'job boards/x', 'a\\b']) assert.equal(isValidPlatformKey(ok), true, ok);
  for (const bad of ['', '..', '../x', 'a/../b', 'C:\\x', '__x', 'a/__x', 'a/_SNAPSHOTS', '.hidden', 'a//b', 'node_modules/x']) {
    assert.equal(isValidPlatformKey(bad), false, bad);
  }
});

test('resolveRoot prefers --root, then the environment variable, then ./profiles', () => {
  assert.equal(resolveRoot('given', { [ROOT_ENV]: 'fromenv' }), path.resolve('given'));
  assert.equal(resolveRoot(undefined, { [ROOT_ENV]: 'fromenv' }), path.resolve('fromenv'));
  assert.equal(resolveRoot(undefined, { [ROOT_ENV]: '  ' }), path.resolve(DEFAULT_ROOT_DIR));
  assert.equal(resolveRoot(undefined, {}), path.resolve('profiles'));
  assert.equal(DEFAULT_ROOT_DIR, 'profiles');
});

test('resolvePlatform accepts either slash style and returns null for unknown or content folders', () => {
  assert.equal(resolvePlatform(FIXTURE, 'social media\\gamma\\profile')?.key, GAMMA);
  assert.equal(resolvePlatform(FIXTURE, `${ALPHA}/`)?.key, ALPHA);
  assert.equal(resolvePlatform(FIXTURE, 'social media/reddit'), null);
  assert.equal(resolvePlatform(FIXTURE, 'contract/nope'), null);
  assert.equal(resolvePlatform(FIXTURE, '../etc'), null);
});

test('latestSnapshots returns the newest snapshot per page and orders collision names after the plain name', async (t) => {
  const root = await copyFixture(t);
  const alpha = resolvePlatform(root, ALPHA);
  const latest = latestSnapshots(alpha.dir);
  assert.deepEqual(latest.map((item) => item.file), ['2026-10-02-1000-profile.txt', '2026-10-02-1005-settings.txt']);
  assert.deepEqual(latestSnapshots(alpha.dir, 'profile').map((item) => item.file), ['2026-10-02-1000-profile.txt']);

  const body = (name) => formatSnapshot({ url: 'https://a.example.test', captured_at: '2026-10-02T11:00:00-04:00', page: 'profile', body: name });
  const dir = join(alpha.dir, '_SNAPSHOTS');
  await writeFile(join(dir, '2026-10-02-1100-profile.txt'), body('first'));
  await writeFile(join(dir, '2026-10-02-1100-profile-2.txt'), body('second'));
  await writeFile(join(dir, '2026-10-02-1100-profile-10.txt'), body('tenth'));
  assert.equal(latestSnapshots(alpha.dir, 'profile')[0].file, '2026-10-02-1100-profile-10.txt');
});

test('parseArgs handles values, flags, equals form and rejects bad input', () => {
  const spec = { strings: ['root', 'page'], booleans: ['json'], positionals: 1 };
  const parsed = parseArgs(['save', '--root', 'a b', '--page=home', '--json'], spec);
  assert.deepEqual(parsed.values, { root: 'a b', page: 'home', json: true });
  assert.deepEqual(parsed.positionals, ['save']);
  assert.throws(() => parseArgs(['--nope'], spec), UsageError);
  assert.throws(() => parseArgs(['--root'], spec), UsageError);
  assert.throws(() => parseArgs(['--root', '--json'], spec), UsageError);
  assert.throws(() => parseArgs(['--json=1'], spec), UsageError);
  assert.throws(() => parseArgs(['a', 'b'], spec), UsageError);
});

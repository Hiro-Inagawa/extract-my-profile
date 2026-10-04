import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { validateCollection } from '../scripts/validate.mjs';
import { resolvePlatform } from '../scripts/lib.mjs';
import { ALPHA, GAMMA, codes, copyFixture, inline, mutate, run, writeSidecar } from './helpers.mjs';

const ALPHA_STATE = `${ALPHA}/CURRENT-STATE.md`;
const GAMMA_STATE = `${GAMMA}/CURRENT-STATE.md`;
const ALPHA_SNAPSHOT = `${ALPHA}/_SNAPSHOTS/2026-10-02-1000-profile.txt`;

function validate(root, extra = {}) {
  return validateCollection({
    root,
    platformFilter: null,
    sidecarPath: join(root, 'APPROVED-PROFILE-TEXTS.json'),
    approvedMdPath: join(root, 'APPROVED-PROFILE-TEXTS.md'),
    ...extra,
  });
}

test('the clean fixture passes, as a child process in text and JSON form', async (t) => {
  const root = await copyFixture(t);
  const text = run('validate.mjs', ['--root', root]);
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, /^PASS contract\/alpha\nPASS job boards\/beta\nPASS social media\/gamma\/profile\nPASS \(sidecar\)\n/);
  assert.match(text.stdout, /Summary: 4 checked, 4 passed, 0 failed, 0 finding\(s\)\./);
  const json = run('validate.mjs', ['--root', root, '--json']);
  assert.equal(json.status, 0);
  assert.deepEqual(JSON.parse(json.stdout), { status: 'pass', findings: [] });
});

test('a failing collection exits 1 and names the platform and code', async (t) => {
  const root = await copyFixture(t);
  await mutate(root, ALPHA_STATE, ['Last verified: 2026-10-02', 'Last verified: 2026-13-45']);
  const text = run('validate.mjs', ['--root', root]);
  assert.equal(text.status, 1);
  assert.match(text.stdout, /FAIL contract\/alpha .*BAD_DATE/);
  const json = JSON.parse(run('validate.mjs', ['--root', root, '--json']).stdout);
  assert.equal(json.status, 'fail');
  assert.ok(json.findings.some((f) => f.platform === ALPHA && f.code === 'BAD_DATE' && f.detail.length > 0));
});

const MUTATIONS = [
  ['BAD_DATE', ALPHA_STATE, ['Last verified: 2026-10-02', 'Last verified: 2026-02-30']],
  ['BAD_DATE', ALPHA_STATE, ['Last verified: 2026-10-02', 'Last verified: soon']],
  ['SECTION_MISSING', ALPHA_STATE, ['## Open\n\nNothing is open.\n\n', '']],
  [
    'SECTION_ORDER',
    ALPHA_STATE,
    ['## Profile\n\nHeadline and summary are set.\n\n## Settings\n\nVisibility is public.\n\n', '## Settings\n\nVisibility is public.\n\n## Profile\n\nHeadline and summary are set.\n\n'],
  ],
  ['SECTION_EXTRA', ALPHA_STATE, (text) => `${text}\n## Extra notes\n\nNot allowed.\n`],
  ['HEADER_MISSING', ALPHA_STATE, ['Owner: Fixture Person\n', '']],
  ['HEADER_MISSING', ALPHA_STATE, ['Status: Live', 'Status: ']],
  ['HEADER_ORDER', ALPHA_STATE, ['Status: Live\nOwner: Fixture Person\n', 'Owner: Fixture Person\nStatus: Live\n']],
  ['HEADER_ORDER', ALPHA_STATE, ['Status: Live\n', 'Status: Live\nStatus: Live\n']],
  ['TITLE', ALPHA_STATE, ['# Alpha profile, current state', '# Alpha profile']],
  ['BAD_URL', ALPHA_STATE, ['https://alpha.example.test/people/fixture', 'ftp://alpha.example.test/x']],
  ['BAD_URL', ALPHA_STATE, ['https://alpha.example.test/people/fixture', 'alpha dot example']],
  ['CATEGORY_MISMATCH', ALPHA_STATE, ['Category: contract', 'Category: employers']],
  ['SNAPSHOT_MISSING', ALPHA_STATE, ['_SNAPSHOTS/2026-10-02-1000-profile.txt', '_SNAPSHOTS/2099-01-01-0000-profile.txt']],
  ['SNAPSHOT_MISSING', ALPHA_STATE, ['Last snapshot: _SNAPSHOTS/2026-10-02-1000-profile.txt', 'Last snapshot: yesterday']],
  ['SNAPSHOT_HASH', ALPHA_SNAPSHOT, ['Rate: $100/hr', 'Rate: $999/hr']],
  ['SNAPSHOT_HASH', ALPHA_SNAPSHOT, (text) => text.replace('---\n', '---\n\n')],
  ['REGISTRY_MISSING', 'PROFILES.md', ['- [Alpha](contract/alpha/CURRENT-STATE.md), verified 2026-10-02\n', '']],
  ['REGISTRY_DATE', 'PROFILES.md', ['Alpha](contract/alpha/CURRENT-STATE.md), verified 2026-10-02', 'Alpha](contract/alpha/CURRENT-STATE.md), verified 2026-09-01']],
  ['REGISTRY_DATE', 'PROFILES.md', ['Alpha](contract/alpha/CURRENT-STATE.md), verified 2026-10-02', 'Alpha](contract/alpha/CURRENT-STATE.md), checked']],
  ['REGISTRY_PATH_MISSING', 'PROFILES.md', (text) => `${text}- \`job boards/ghost\`, folder does not exist\n`],
  ['CATEGORY_MISMATCH', GAMMA_STATE, ['Category: social media', 'Category: None']],
  ['SIDECAR_TEXT_NOT_IN_MD', 'APPROVED-PROFILE-TEXTS.md', ['Senior product designer', 'Principal product designer']],
];

for (const [code, file, change] of MUTATIONS) {
  test(`${code} fires on a mutated copy (${file.split('/').pop()}: ${typeof change === 'function' ? 'function' : change[1].slice(0, 28).replace(/\n/g, ' ')})`, async (t) => {
    const root = await copyFixture(t);
    assert.deepEqual(codes(validate(root)), []);
    await mutate(root, file, change);
    const result = validate(root);
    assert.equal(result.status, 'fail');
    assert.ok(codes(result).includes(code), `expected ${code}, got ${codes(result).join(', ')}`);
  });
}

test('the registry link may be percent-encoded instead of wrapped in angle brackets', async (t) => {
  const root = await copyFixture(t);
  await mutate(root, 'PROFILES.md', ['<social media/gamma/profile/CURRENT-STATE.md>', 'social%20media/gamma/profile/CURRENT-STATE.md']);
  assert.equal(validate(root).status, 'pass');
});

test('a snapshot in a Last snapshot header that was deleted is SNAPSHOT_MISSING, not a crash', async (t) => {
  const root = await copyFixture(t);
  await rm(join(root, ...ALPHA_SNAPSHOT.split('/')));
  assert.ok(codes(validate(root)).includes('SNAPSHOT_MISSING'));
});

test('a platform folder with snapshots but no CURRENT-STATE.md and no registry entry is flagged', async (t) => {
  const root = await copyFixture(t);
  await mkdir(join(root, 'marketplaces', 'epsilon', '_SNAPSHOTS'), { recursive: true });
  const result = validate(root);
  assert.deepEqual(result.findings.map((f) => [f.platform, f.code]), [['marketplaces/epsilon', 'REGISTRY_UNLISTED_EMPTY']]);
});

test('sidecar findings: unknown platform, duplicate id, schema, unresolved resume and missing file', async (t) => {
  const root = await copyFixture(t);
  const text = 'Senior product designer for AI platforms';

  await writeSidecar(root, [inline('a', text, ['contract/nope'])]);
  assert.deepEqual(codes(validate(root)), ['SIDECAR_UNKNOWN_PLATFORM']);

  await writeSidecar(root, [inline('a', text, [ALPHA]), inline('a', text, [ALPHA])]);
  assert.deepEqual(codes(validate(root)), ['SIDECAR_DUPLICATE_ID']);

  await writeFile(join(root, 'APPROVED-PROFILE-TEXTS.json'), '{"schema":"wrong","texts":[{"id":"x"}]}');
  assert.ok(codes(validate(root)).every((code) => code === 'SIDECAR_SCHEMA'));
  assert.ok(codes(validate(root)).length >= 2);

  await writeSidecar(root, [{ id: 'r', source: { type: 'resume-section', file: '__sources/resume.md', heading: '## NOPE' }, platforms: [ALPHA] }]);
  assert.deepEqual(codes(validate(root)), ['SIDECAR_RESUME_UNRESOLVED']);

  await rm(join(root, 'APPROVED-PROFILE-TEXTS.json'));
  assert.deepEqual(codes(validate(root)), ['SIDECAR_SCHEMA']);
});

test('--approved-md points the sidecar check at another Markdown file', async (t) => {
  const root = await copyFixture(t);
  const other = join(root, 'other-approved.md');
  await writeFile(other, 'Nothing relevant here.\n');
  const failing = run('validate.mjs', ['--root', root, '--approved-md', other]);
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /SIDECAR_TEXT_NOT_IN_MD/);
});

test('--platform limits template and registry checks to one platform but still runs the sidecar checks', async (t) => {
  const root = await copyFixture(t);
  await mutate(root, GAMMA_STATE, ['Owner: Fixture Person\n', '']);
  assert.ok(codes(validate(root)).includes('HEADER_MISSING'));
  assert.equal(validate(root, { platformFilter: ALPHA }).status, 'pass');
  const cli = run('validate.mjs', ['--root', root, '--platform', ALPHA]);
  assert.equal(cli.status, 0, cli.stdout);
  assert.match(cli.stdout, /Summary: 2 checked, 2 passed/);

  await mutate(root, 'APPROVED-PROFILE-TEXTS.md', ['Senior product designer', 'Principal product designer']);
  assert.deepEqual(codes(validate(root, { platformFilter: ALPHA })), ['SIDECAR_TEXT_NOT_IN_MD']);
});

test('--platform with an unknown key or the reddit content folder exits 2', async (t) => {
  const root = await copyFixture(t);
  assert.equal(run('validate.mjs', ['--root', root, '--platform', 'contract/nope']).status, 2);
  assert.equal(run('validate.mjs', ['--root', root, '--platform', 'social media/reddit']).status, 2);
});

test('reddit and double-underscore folders are never treated as platforms', async (t) => {
  const root = await copyFixture(t);
  const result = validate(root);
  assert.deepEqual(result.checked, [ALPHA, 'job boards/beta', GAMMA, '(sidecar)']);
  assert.equal(resolvePlatform(root, 'social media/reddit'), null);
  assert.ok(!run('validate.mjs', ['--root', root]).stdout.includes('reddit'));
});

test('CRLF line endings in CURRENT-STATE.md and PROFILES.md still validate', async (t) => {
  const root = await copyFixture(t);
  for (const file of [ALPHA_STATE, 'PROFILES.md']) await mutate(root, file, (text) => text.replace(/\n/g, '\r\n'));
  assert.equal(validate(root).status, 'pass');
});

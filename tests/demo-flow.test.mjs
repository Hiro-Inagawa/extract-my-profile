import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeBody, sha256 } from '../scripts/lib.mjs';
import { run, tempDir } from './helpers.mjs';
import { htmlToPageText } from './html-text.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, '..', 'examples', 'demo-platform');
const TEMPLATE = join(here, '..', 'references', 'CURRENT-STATE-TEMPLATE.md');
const BASE_URL = 'http://127.0.0.1:4173/demo-platform';

async function pageText(name) {
  return htmlToPageText(await readFile(join(EXAMPLE, name), 'utf8'));
}

/** The fingerprint the page would compute: sha256 of the normalized text, which is what browser-capture.js returns. */
function fingerprint(text) {
  return sha256(normalizeBody(text));
}

function snapshot(root, scratch, name, text, now) {
  return run('snapshot.mjs', [
    'save',
    '--root',
    root,
    '--create',
    '--platform',
    'demo-platform',
    '--page',
    'profile',
    '--url',
    `${BASE_URL}/${name}`,
    '--input',
    scratch,
    '--now',
    now,
    '--expect-sha256',
    fingerprint(text),
  ]);
}

test('the two example pages differ in exactly three places', async () => {
  const v1 = (await pageText('profile-v1.html')).split('\n');
  const v2 = (await pageText('profile-v2.html')).split('\n');
  assert.equal(v2.length, v1.length + 1);
  assert.ok(v1.includes('Product Designer (UX/UI)'));
  assert.ok(v2.includes('Product Designer (UX/UI) | Fintech'));
  assert.ok(v1.includes('Los Angeles, California') && v2.includes('Los Angeles Metropolitan Area'));
  assert.ok(!v1.includes('Design systems') && v2[v2.indexOf('Wordpress') + 1] === 'Design systems');
  assert.equal(v1.filter((line) => !v2.includes(line)).length, 2);
  assert.equal(v2.filter((line) => !v1.includes(line)).length, 3);
  for (const text of [v1, v2]) {
    assert.ok(text.includes('Haley Meadows'));
    for (const heading of ['About', 'Experience', 'Education', 'Skills', 'Languages', 'Featured', 'Projects', 'Recommendations']) assert.ok(text.includes(heading), heading);
    assert.equal(text.filter((line) => line === 'Nothing added yet').length, 3);
    assert.ok(text.includes('Kestrel Pay, Mar 2025 to Present') && text.includes('Lumo Finance, Jun 2022 to Mar 2025'));
  }
  assert.ok(!v1.join('\n').includes('<') && !v1.some((line) => /title|style|font-family/i.test(line)));
});

test('first-time flow with scripts only: init, two snapshots, diff, state from the template, validate, check-approved', async (t) => {
  const dir = await tempDir(t);
  const root = join(dir, 'profiles');
  assert.equal(run('init.mjs', ['--root', root]).status, 0);

  const v1 = await pageText('profile-v1.html');
  const v2 = await pageText('profile-v2.html');
  const scratch1 = join(dir, 'v1.txt');
  const scratch2 = join(dir, 'v2.txt');
  await writeFile(scratch1, v1);
  await writeFile(scratch2, v2);

  const first = snapshot(root, scratch1, 'profile-v1.html', v1, '2026-10-04T09:00:00+00:00');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).status, 'new');
  const second = snapshot(root, scratch2, 'profile-v2.html', v2, '2026-10-04T09:05:00+00:00');
  assert.equal(second.status, 0, second.stderr);
  const secondResult = JSON.parse(second.stdout);
  assert.equal(secondResult.status, 'changed');
  assert.match(secondResult.capture_check, /^browser-sha256 [0-9a-f]{64}$/);

  const diff = run('diff.mjs', ['--root', root, '--platform', 'demo-platform']);
  assert.equal(diff.status, 0, diff.stderr);
  for (const line of [
    '- Product Designer (UX/UI)',
    '+ Product Designer (UX/UI) | Fintech',
    '- Los Angeles, California',
    '+ Los Angeles Metropolitan Area',
    '+ Design systems',
  ]) {
    assert.ok(diff.stdout.includes(line), `diff lacks: ${line}`);
  }

  const state = (await readFile(TEMPLATE, 'utf8'))
    .replace('# <Platform name> profile, current state', '# Demo platform profile, current state')
    .replace('Last verified: YYYY-MM-DD', 'Last verified: 2026-10-04')
    .replace('Status: Current authority for what the <Platform name> profile says today', 'Status: Current authority for what the Demo platform profile says today')
    .replace('Owner: <Name of the person the profile belongs to>', 'Owner: Haley Meadows')
    .replace('Profile URL: https://...', `Profile URL: ${BASE_URL}/profile-v2.html`)
    .replace(/^Category: .*$/m, 'Category: None')
    .replace('Last snapshot: _SNAPSHOTS/YYYY-MM-DD-HHMM-<page>[-2].txt', `Last snapshot: _SNAPSHOTS/${secondResult.file}`);
  await writeFile(join(root, 'demo-platform', 'CURRENT-STATE.md'), state);

  const registryFile = join(root, 'PROFILES.md');
  await writeFile(registryFile, `${await readFile(registryFile, 'utf8')}`.replace('## Verified\n', '## Verified\n\n- [Demo platform](demo-platform/CURRENT-STATE.md), verified 2026-10-04\n'));

  const validate = run('validate.mjs', ['--root', root]);
  assert.equal(validate.status, 0, validate.stdout);
  assert.match(validate.stdout, /PASS demo-platform/);

  await writeFile(
    join(root, 'APPROVED-PROFILE-TEXTS.json'),
    JSON.stringify({
      schema: 'approved-profile-texts-v1',
      texts: [
        { id: 'headline', source: { type: 'inline' }, text: 'Product Designer (UX/UI) | Fintech', platforms: ['demo-platform'] },
        { id: 'old-location', source: { type: 'inline' }, text: 'Los Angeles, California', platforms: ['demo-platform'] },
      ],
    }),
  );
  await writeFile(join(root, 'APPROVED-PROFILE-TEXTS.md'), '# Approved profile texts\n\n## Headline\n\nProduct Designer (UX/UI) | Fintech\n\n## Old location\n\nLos Angeles, California\n');
  const approved = run('check-approved.mjs', ['--root', root]);
  assert.equal(approved.status, 1, approved.stdout);
  assert.match(approved.stdout, /\| headline \| demo-platform \| present \|/);
  assert.match(approved.stdout, /\| old-location \| demo-platform \| differs \|/);
  assert.equal(run('validate.mjs', ['--root', root]).status, 0);
});

test('a fingerprint of the other page version is refused and writes nothing', async (t) => {
  const dir = await tempDir(t);
  const root = join(dir, 'profiles');
  run('init.mjs', ['--root', root]);
  const v1 = await pageText('profile-v1.html');
  const v2 = await pageText('profile-v2.html');
  const scratch = join(dir, 'v1.txt');
  await writeFile(scratch, v1);
  const result = snapshot(root, scratch, 'profile-v1.html', v2, '2026-10-04T09:00:00+00:00');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match the page fingerprint/);
  assert.deepEqual((await readdir(root)).sort(), ['.gitignore', 'APPROVED-PROFILE-TEXTS.json', 'APPROVED-PROFILE-TEXTS.md', 'PROFILES.md', 'README.md']);
});

test('the template has exactly the sections the validator requires, in order', async () => {
  const template = await readFile(TEMPLATE, 'utf8');
  const headings = [...template.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(headings, ['What the platform is', 'Profile', 'Settings', 'Not read', 'Open', 'Change history']);
});

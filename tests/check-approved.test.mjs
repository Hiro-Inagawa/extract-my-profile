import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { extractResumeSection } from '../scripts/approved-lib.mjs';
import { checkApproved } from '../scripts/check-approved.mjs';
import { saveSnapshot } from '../scripts/snapshot.mjs';
import { ALPHA, BETA, GAMMA, copyFixture, inline, run, tempDir, writeSidecar } from './helpers.mjs';

const ALPHA_SUMMARY = 'I design AI products for teams that need clarity, from first research to shipped interface.';

async function check(t, texts, platformFilter = null) {
  const root = await copyFixture(t);
  const sidecarPath = await writeSidecar(root, texts);
  return { root, sidecarPath, results: checkApproved({ root, sidecarPath, platformFilter }) };
}

async function saveBeta(t, root, body, now = '2026-10-03T09:00:00-04:00') {
  const input = join(await tempDir(t), 'in.txt');
  await writeFile(input, body);
  saveSnapshot({ root, platform: BETA, page: 'home', url: 'https://beta.example.test/me', input, now });
}

test('the clean fixture reports present for Alpha and exits 0, as a child process', async (t) => {
  const root = await copyFixture(t);
  const result = run('check-approved.mjs', ['--root', root, '--platform', ALPHA]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\| Text \| Platform \| Status \| Closest line \|\n\| --- \| --- \| --- \| --- \|\n/);
  assert.match(result.stdout, /\| alpha-summary \| contract\/alpha \| present \|/);
  assert.match(result.stdout, /Checked 3 pair\(s\): 3 present, 0 differs, 0 missing/);
});

test('without --platform the Gamma pair has no snapshot and the run exits 1, with --json output', async (t) => {
  const root = await copyFixture(t);
  const result = run('check-approved.mjs', ['--root', root, '--json']);
  assert.equal(result.status, 1);
  const rows = JSON.parse(result.stdout);
  assert.deepEqual(
    rows.map((row) => [row.id, row.platform, row.status]),
    [
      ['alpha-summary', ALPHA, 'present'],
      ['alpha-headline', ALPHA, 'present'],
      ['resume-profile', ALPHA, 'present'],
      ['resume-profile', GAMMA, 'no-snapshot'],
    ],
  );
});

test('a text that is not on the page is missing and exits 1', async (t) => {
  const { root, results } = await check(t, [inline('gone', 'Completely unrelated sentence about gardening tools and soil.', [ALPHA])]);
  assert.equal(results[0].status, 'missing');
  assert.equal(results[0].closest, '');
  const result = run('check-approved.mjs', ['--root', root]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\| gone \| contract\/alpha \| missing \|/);
});

test('a near match is differs and names the closest snapshot line', async (t) => {
  const edited = 'I design AI products for teams that need clarity, from first research to launched interface.';
  const { results } = await check(t, [inline('near', edited, [ALPHA])]);
  assert.equal(results[0].status, 'differs');
  assert.equal(results[0].closest, ALPHA_SUMMARY);
  assert.ok(results[0].similarity >= 0.6 && results[0].similarity < 1);
});

test('whitespace differences and case are handled: whitespace ignored, case preserved', async (t) => {
  const spaced = '  I design   AI products for teams\nthat need clarity,\tfrom first research  to shipped interface.  ';
  const lower = ALPHA_SUMMARY.toLowerCase();
  const { results } = await check(t, [inline('spaced', spaced, [ALPHA]), inline('lower', lower, [ALPHA])]);
  assert.equal(results[0].status, 'present');
  assert.equal(results[1].status, 'differs');
});

test('curly quotes, en and em dashes match their plain forms in both directions', async (t) => {
  const root = await copyFixture(t);
  await saveBeta(t, root, 'She said “hello” \u2014 it’s fine\nPlain "quote" and it\'s - dash\n');
  const sidecarPath = await writeSidecar(root, [
    inline('plain-for-curly', 'She said "hello" - it\'s fine', [BETA]),
    inline('curly-for-plain', 'Plain “quote” and it’s – dash', [BETA]),
  ]);
  const results = checkApproved({ root, sidecarPath, platformFilter: null });
  assert.deepEqual(results.map((row) => row.status), ['present', 'present']);
});

test('a resume-section text resolves links to labels and bold markers away', async (t) => {
  const { results } = await check(t, [
    { id: 'r', source: { type: 'resume-section', file: '__sources/resume.md', heading: '## PROFILE' }, platforms: [ALPHA] },
  ]);
  assert.equal(results[0].status, 'present');
});

test('an unresolved resume source gives source-unresolved and an unknown platform gives unknown-platform', async (t) => {
  const { results } = await check(t, [
    { id: 'nohead', source: { type: 'resume-section', file: '__sources/resume.md', heading: '## NOPE' }, platforms: [ALPHA] },
    { id: 'nofile', source: { type: 'resume-section', file: '__sources/absent.md', heading: '## PROFILE' }, platforms: [ALPHA] },
    inline('nowhere', 'Some text', ['contract/nope']),
  ]);
  assert.deepEqual(results.map((row) => row.status), ['source-unresolved', 'source-unresolved', 'unknown-platform']);
});

test('only the latest snapshot of each page counts', async (t) => {
  const root = await copyFixture(t);
  await saveBeta(t, root, 'Old claim about rates\n', '2026-10-03T09:00:00-04:00');
  await saveBeta(t, root, 'New claim about rates\n', '2026-10-03T10:00:00-04:00');
  const sidecarPath = await writeSidecar(root, [inline('old', 'Old claim about rates', [BETA]), inline('new', 'New claim about rates', [BETA])]);
  const results = checkApproved({ root, sidecarPath, platformFilter: null });
  assert.equal(results[0].status, 'differs');
  assert.equal(results[1].status, 'present');
});

test('sidecar platform keys may use backslashes and --platform filters the pairs', async (t) => {
  const { results } = await check(
    t,
    [inline('a', ALPHA_SUMMARY, ['contract\\alpha']), inline('b', ALPHA_SUMMARY, [GAMMA])],
    ALPHA,
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].platform, ALPHA);
});

test('a missing or broken sidecar and an unknown --platform exit 2', async (t) => {
  const root = await copyFixture(t);
  assert.equal(run('check-approved.mjs', ['--root', root, '--sidecar', join(root, 'nope.json')]).status, 2);
  const broken = join(root, 'broken.json');
  await writeFile(broken, '{"schema":"other","texts":[]}');
  assert.equal(run('check-approved.mjs', ['--root', root, '--sidecar', broken]).status, 2);
  assert.equal(run('check-approved.mjs', ['--root', root, '--platform', 'contract/nope']).status, 2);
});

test('output never contains a whole snapshot and long closest lines are clipped', async (t) => {
  const root = await copyFixture(t);
  const longLine = `alpha beta gamma ${'filler '.repeat(100)}end`;
  await saveBeta(t, root, `Header line\n${longLine}\nFooter line\n`);
  const sidecarPath = await writeSidecar(root, [inline('long', 'alpha beta gamma delta', [BETA])]);
  const results = checkApproved({ root, sidecarPath, platformFilter: null });
  assert.equal(results[0].status, 'differs');
  assert.ok(results[0].closest.length <= 303);
  assert.ok(!results[0].closest.includes('Header line'));
});

test('extractResumeSection stops at a same-level heading, keeps subsections and skips fenced headings', () => {
  const md = '# T\n\n## PROFILE\n\nFirst **bold** [label](https://x.test).\n\n```\n## not a heading\n```\n\n### Sub\n\nSub text\n\n## NEXT\n\nOther\n';
  assert.equal(
    extractResumeSection(md, '## PROFILE'),
    'First bold label.\n\n```\n## not a heading\n```\n\n### Sub\n\nSub text',
  );
  assert.equal(extractResumeSection(md, '## MISSING'), null);
  assert.equal(extractResumeSection('## EMPTY\n\n## NEXT\ntext', '## EMPTY'), null);
  assert.equal(extractResumeSection('## A\r\ntext one\r\n\r\n## B\r\n', '## A'), 'text one');
});

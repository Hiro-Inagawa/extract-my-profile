import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = join(here, 'fixtures', 'PROFILES');
export const SCRIPTS = join(here, '..', 'scripts');

export const ALPHA = 'contract/alpha';
export const BETA = 'job boards/beta';
export const GAMMA = 'social media/gamma/profile';

/** A throwaway copy of the synthetic collection. Removed when the test finishes. */
export async function copyFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'extract-my-profile-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'PROFILES');
  await cp(FIXTURE, root, { recursive: true });
  return root;
}

export async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'extract-my-profile-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Rewrites a file under root. Fails when the replacement changes nothing, so a typo cannot hide a test. */
export async function mutate(root, relativePath, change) {
  const file = join(root, ...relativePath.split('/'));
  const before = await readFile(file, 'utf8');
  const after = typeof change === 'function' ? change(before) : before.replace(change[0], () => change[1]);
  assert.notEqual(after, before, `mutation of ${relativePath} changed nothing`);
  await writeFile(file, after);
}

export async function writeSidecar(root, texts, fileName = 'APPROVED-PROFILE-TEXTS.json') {
  const file = join(root, fileName);
  await writeFile(file, JSON.stringify({ schema: 'approved-profile-texts-v1', texts }));
  return file;
}

export function inline(id, text, platforms) {
  return { id, source: { type: 'inline' }, text, platforms };
}

/** Runs one of the CLIs as a child process. */
export function run(script, args) {
  const result = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function codes(result) {
  return result.findings.map((finding) => finding.code);
}

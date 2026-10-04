import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { loadSidecar } from '../scripts/approved-lib.mjs';
import { COLLECTION_FILES, initCollection } from '../scripts/init.mjs';
import { SCRIPTS, run, tempDir } from './helpers.mjs';

const FILES = ['.gitignore', 'APPROVED-PROFILE-TEXTS.json', 'APPROVED-PROFILE-TEXTS.md', 'PROFILES.md', 'README.md'];

test('init creates the collection files and the result passes validate and check-approved at once', async (t) => {
  const root = join(await tempDir(t), 'profiles');
  const init = run('init.mjs', ['--root', root]);
  assert.equal(init.status, 0, init.stderr);
  assert.deepEqual((await readdir(root)).sort(), FILES);
  const validate = run('validate.mjs', ['--root', root]);
  assert.equal(validate.status, 0, validate.stdout);
  assert.match(validate.stdout, /PASS \(sidecar\)/);
  assert.match(validate.stdout, /Summary: 1 checked, 1 passed, 0 failed, 0 finding\(s\)\./);
  assert.equal(run('check-approved.mjs', ['--root', root]).status, 0);
});

test('the registry has Verified and Registered sections and the sidecar is empty in the exact shape the scripts read', async (t) => {
  const root = await tempDir(t);
  initCollection(root);
  const registry = await readFile(join(root, 'PROFILES.md'), 'utf8');
  assert.match(registry, /^## Verified$/m);
  assert.match(registry, /^## Registered$/m);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'APPROVED-PROFILE-TEXTS.json'), 'utf8')), {
    schema: 'approved-profile-texts-v1',
    texts: [],
  });
  const sidecar = loadSidecar(join(root, 'APPROVED-PROFILE-TEXTS.json'));
  assert.equal(sidecar.state, 'ok');
  assert.deepEqual(sidecar.entries, []);
  assert.match(await readFile(join(root, '.gitignore'), 'utf8'), /^_SNAPSHOTS\/$/m);
});

test('init refuses to overwrite and leaves every existing file and the rest untouched', async (t) => {
  const root = await tempDir(t);
  await writeFile(join(root, 'PROFILES.md'), 'my own registry\n');
  const result = run('init.mjs', ['--root', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to overwrite.*PROFILES\.md/);
  assert.equal(await readFile(join(root, 'PROFILES.md'), 'utf8'), 'my own registry\n');
  assert.deepEqual(await readdir(root), ['PROFILES.md']);
});

test('a second init on a fresh collection is refused and names every file', async (t) => {
  const root = await tempDir(t);
  initCollection(root);
  const before = await readFile(join(root, 'README.md'), 'utf8');
  assert.throws(() => initCollection(root), (error) => FILES.every((name) => error.message.includes(name)));
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), before);
  assert.equal(run('init.mjs', ['--root', root]).status, 1);
});

test('init creates missing parent folders and leaves unrelated files already in the folder alone', async (t) => {
  const dir = await tempDir(t);
  const root = join(dir, 'a', 'b', 'profiles');
  assert.equal(run('init.mjs', ['--root', root]).status, 0);
  const other = join(dir, 'other');
  await mkdir(other);
  await writeFile(join(other, 'notes.txt'), 'keep\n');
  assert.equal(run('init.mjs', ['--root', other]).status, 0);
  assert.equal(await readFile(join(other, 'notes.txt'), 'utf8'), 'keep\n');
});

test('init and the checks use ./profiles under the working directory when no root is given', async (t) => {
  const cwd = await tempDir(t);
  const env = { ...process.env };
  delete env.EXTRACT_MY_PROFILE_ROOT;
  const exec = (script, args = []) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { cwd, env, encoding: 'utf8' });
  assert.equal(exec('init.mjs').status, 0);
  assert.deepEqual((await readdir(join(cwd, 'profiles'))).sort(), FILES);
  assert.equal(exec('validate.mjs').status, 0);
  assert.equal(exec('check-approved.mjs').status, 0);
});

test('EXTRACT_MY_PROFILE_ROOT sets the root and --root wins over it', async (t) => {
  const dir = await tempDir(t);
  const fromEnv = join(dir, 'from-env');
  const fromFlag = join(dir, 'from-flag');
  const exec = (args) =>
    spawnSync(process.execPath, [join(SCRIPTS, 'init.mjs'), ...args], {
      cwd: dir,
      env: { ...process.env, EXTRACT_MY_PROFILE_ROOT: fromEnv },
      encoding: 'utf8',
    });
  assert.equal(exec([]).status, 0);
  assert.deepEqual((await readdir(fromEnv)).sort(), FILES);
  assert.equal(exec(['--root', fromFlag]).status, 0);
  assert.deepEqual((await readdir(fromFlag)).sort(), FILES);
});

test('init rejects an unknown option with exit 2', () => {
  assert.equal(run('init.mjs', ['--nope']).status, 2);
});

test('the file list init writes is the list this test expects', () => {
  assert.deepEqual(Object.keys(COLLECTION_FILES).sort(), FILES);
});

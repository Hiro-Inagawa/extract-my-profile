import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { SCRIPTS, copyFixture, tempDir } from './helpers.mjs';

// The skill is installed as a junction (Windows) or symlink. Scripts run through it
// must still execute; a silent exit 0 would hide every check.
test('validate.mjs runs through a junction to the scripts folder', async (t) => {
  const root = await copyFixture(t);
  const linkParent = await tempDir(t);
  const link = join(linkParent, 'scripts-link');
  fs.symlinkSync(SCRIPTS, link, process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, [join(link, 'validate.mjs'), '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Summary: \d+ checked/);
});

test('a usage error through the junction exits 2 instead of silently 0', async (t) => {
  const linkParent = await tempDir(t);
  const link = join(linkParent, 'scripts-link');
  fs.symlinkSync(SCRIPTS, link, process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, [join(link, 'snapshot.mjs'), 'save'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});

// node init.mjs [--root <dir>]
// Creates an empty profile collection. Refuses to overwrite any existing file and writes nothing in that case.
import fs from 'node:fs';
import path from 'node:path';
import { SIDECAR_SCHEMA_ID } from './approved-lib.mjs';
import { EXIT, REGISTRY_FILE, SNAPSHOT_DIR, isMain, parseArgs, resolveRoot, runCli, write } from './lib.mjs';

export const COLLECTION_FILES = {
  [REGISTRY_FILE]: [
    '# Profiles',
    '',
    'One line per platform. A platform with a CURRENT-STATE.md goes under Verified, as',
    '`- [Name](<key>/CURRENT-STATE.md), verified YYYY-MM-DD`. A platform folder without one is listed',
    'under Registered with its folder in backticks.',
    '',
    '## Verified',
    '',
    '## Registered',
    '',
  ].join('\n'),
  'APPROVED-PROFILE-TEXTS.md': [
    '# Approved profile texts',
    '',
    'Texts you approved for your profiles, one `##` section per text. Mirror each one in',
    'APPROVED-PROFILE-TEXTS.json so check-approved.mjs can compare it with the saved snapshots.',
    '',
  ].join('\n'),
  'APPROVED-PROFILE-TEXTS.json': `${JSON.stringify({ schema: SIDECAR_SCHEMA_ID, texts: [] }, null, 2)}\n`,
  'README.md': [
    '# Profile collection',
    '',
    'Created by extract-my-profile. Snapshots in `_SNAPSHOTS` folders can hold phone, email and address,',
    'so keep them private and out of any public repository.',
    '',
  ].join('\n'),
  '.gitignore': `${SNAPSHOT_DIR}/\n`,
};

/** Creates the collection files under root. Throws Error listing every existing file and writes nothing then. */
export function initCollection(root) {
  const existing = Object.keys(COLLECTION_FILES).filter((name) => fs.existsSync(path.join(root, name)));
  if (existing.length > 0) {
    throw new Error(`Refusing to overwrite existing file(s) in ${root}: ${existing.join(', ')}`);
  }
  fs.mkdirSync(root, { recursive: true });
  for (const [name, content] of Object.entries(COLLECTION_FILES)) {
    fs.writeFileSync(path.join(root, name), content, { encoding: 'utf8', flag: 'wx' });
  }
  return Object.keys(COLLECTION_FILES);
}

async function main(argv) {
  const { values } = parseArgs(argv, { strings: ['root'] });
  const root = resolveRoot(values.root);
  try {
    const created = initCollection(root);
    write(`Created ${created.join(', ')} in ${root}`);
    return EXIT.OK;
  } catch (error) {
    if (!error.message.startsWith('Refusing')) throw error;
    process.stderr.write(`${error.message}\n`);
    return EXIT.CHECK_FAILED;
  }
}

if (isMain(import.meta.url)) await runCli(() => main(process.argv.slice(2)));

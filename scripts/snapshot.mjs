// node snapshot.mjs save --platform <key> --page <page> --url <url> --input <file> [--create] [--root <dir>] [--now <RFC3339>] [--expect-sha256 <fingerprint>]
import fs from 'node:fs';
import path from 'node:path';
import {
  EXIT,
  PAGE_RE,
  SNAPSHOT_DIR,
  UsageError,
  formatSnapshot,
  isMain,
  isValidPlatformKey,
  latestSnapshots,
  localRfc3339,
  normalizeBody,
  normalizeKey,
  parseArgs,
  parseRfc3339,
  resolvePlatform,
  resolveRoot,
  runCli,
  sha256,
  write,
} from './lib.mjs';

/**
 * Normalizes the input text and writes a new snapshot file for the page.
 * Returns {file, sha256, previous, status}. Throws UsageError for any unusable input.
 */
/** Thrown when the saved copy does not match the fingerprint the page computed. Exit code 1. */
export class CaptureMismatchError extends Error {}

export function saveSnapshot({ root, platform: key, page, url, input, now, expectSha256, create = false }) {
  let platform = resolvePlatform(root, key);
  if (!platform && create) {
    if (!isValidPlatformKey(key)) throw new UsageError(`Not a usable platform key: ${key}`);
    // The folder itself is created with the snapshot, so a refused copy leaves nothing behind.
    platform = { key: normalizeKey(key), dir: path.join(root, ...normalizeKey(key).split('/')) };
  }
  if (!platform) throw new UsageError(`Platform folder not found: ${key}. Use --create to start a new platform.`);
  if (!PAGE_RE.test(page ?? '')) throw new UsageError('--page must be lowercase letters, digits and hyphens.');
  if (!url || /[\r\n]/.test(url)) throw new UsageError('--url must be a single non-empty line.');
  const capturedAt = now ?? localRfc3339();
  const stamp = parseRfc3339(capturedAt);
  if (!stamp) throw new UsageError(`--now is not a valid RFC 3339 timestamp: ${capturedAt}`);
  if (!fs.existsSync(input)) throw new UsageError(`Input file not found: ${input}`);

  const body = normalizeBody(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
  if (body === '') throw new UsageError('Input is empty after normalization. Nothing saved.');

  const hash = sha256(body);
  let captureCheck = 'none';
  if (expectSha256 !== undefined) {
    const expected = String(expectSha256).replace(/\s+/g, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)) throw new UsageError('--expect-sha256 must be 64 hex characters, spaces allowed.');
    if (expected !== hash) {
      throw new CaptureMismatchError(
        `Copy does not match the page fingerprint (page ${expected}, copy ${hash}). Nothing saved. Capture the page again.`,
      );
    }
    captureCheck = `browser-sha256 ${expected}`;
  }

  const previous = latestSnapshots(platform.dir, page)[0] ?? null;
  let status = 'new';
  if (previous) status = previous.parsed && sha256(previous.parsed.body) === hash ? 'unchanged' : 'changed';

  const dir = path.join(platform.dir, SNAPSHOT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const prefix = `${stamp.date}-${stamp.hhmm}-${page}`;
  const text = formatSnapshot({ url, captured_at: capturedAt, page, body, capture_check: captureCheck });
  for (let attempt = 1; ; attempt += 1) {
    const file = attempt === 1 ? `${prefix}.txt` : `${prefix}-${attempt}.txt`;
    try {
      fs.writeFileSync(path.join(dir, file), text, { encoding: 'utf8', flag: 'wx' });
      return { file, sha256: hash, previous: previous ? previous.file : null, status, capture_check: captureCheck };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command !== 'save') throw new UsageError('First argument must be "save".');
  const { values } = parseArgs(rest, { strings: ['platform', 'page', 'url', 'input', 'root', 'now', 'expect-sha256'], booleans: ['create'] });
  for (const required of ['platform', 'page', 'url', 'input']) {
    if (!values[required]) throw new UsageError(`--${required} is required.`);
  }
  try {
    const result = saveSnapshot({
      root: resolveRoot(values.root),
      platform: values.platform,
      page: values.page,
      url: values.url,
      input: path.resolve(values.input),
      now: values.now,
      expectSha256: values['expect-sha256'],
      create: values.create === true,
    });
    write(JSON.stringify(result));
    return EXIT.OK;
  } catch (error) {
    if (!(error instanceof CaptureMismatchError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return EXIT.CHECK_FAILED;
  }
}

if (isMain(import.meta.url)) await runCli(() => main(process.argv.slice(2)));

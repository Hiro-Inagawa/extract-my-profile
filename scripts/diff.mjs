// node diff.mjs --platform <key> [--page <page>] [--root <dir>]
import {
  EXIT,
  PAGE_RE,
  UsageError,
  isMain,
  parseArgs,
  resolvePlatform,
  resolveRoot,
  runCli,
  snapshotsByPage,
  verifySnapshot,
  write,
} from './lib.mjs';

const MAX_CELLS = 25_000_000;

function splitLines(body) {
  const lines = body.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Line-level diff. Returns [{op: ' ' | '-' | '+', line}] in document order. */
export function diffLines(oldLines, newLines) {
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start += 1;
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld -= 1;
    endNew -= 1;
  }
  const a = oldLines.slice(start, endOld);
  const b = newLines.slice(start, endNew);
  const ops = oldLines.slice(0, start).map((line) => ({ op: ' ', line }));

  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    ops.push(...a.map((line) => ({ op: '-', line })), ...b.map((line) => ({ op: '+', line })));
  } else {
    const width = b.length + 1;
    const lcs = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        lcs[i * width + j] =
          a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        ops.push({ op: ' ', line: a[i] });
        i += 1;
        j += 1;
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
        ops.push({ op: '-', line: a[i] });
        i += 1;
      } else {
        ops.push({ op: '+', line: b[j] });
        j += 1;
      }
    }
    for (; i < a.length; i += 1) ops.push({ op: '-', line: a[i] });
    for (; j < b.length; j += 1) ops.push({ op: '+', line: b[j] });
  }
  ops.push(...oldLines.slice(endOld).map((line) => ({ op: ' ', line })));
  return ops;
}

/** Keeps every change plus one unchanged line of context on each side. */
export function renderHunks(ops) {
  const keep = ops.map(() => false);
  ops.forEach((entry, index) => {
    if (entry.op === ' ') return;
    for (const k of [index - 1, index, index + 1]) if (k >= 0 && k < ops.length) keep[k] = true;
  });
  return ops.filter((_, index) => keep[index]).map((entry) => `${entry.op} ${entry.line}`);
}

function fenceFor(lines) {
  let longest = 0;
  for (const line of lines) for (const run of line.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/** Markdown section for one page, or {error} when a snapshot fails verification. */
export function diffPage(page, items) {
  const checked = items.length >= 2 ? items.slice(-2) : items;
  for (const item of checked) {
    const result = verifySnapshot(item.text);
    if (!result.ok) return { error: `${item.file}: ${result.error ?? 'sha256 does not match the body'}` };
  }
  if (items.length < 2) return { markdown: `Only one snapshot for ${page}.` };
  const [older, newer] = checked;
  const heading = `### ${page}: ${older.file} -> ${newer.file}`;
  const ops = diffLines(splitLines(older.parsed.body), splitLines(newer.parsed.body));
  if (ops.every((entry) => entry.op === ' ')) return { markdown: `${heading}\nNo change.` };
  const hunks = renderHunks(ops);
  const fence = fenceFor(hunks);
  return { markdown: `${heading}\n${fence}diff\n${hunks.join('\n')}\n${fence}` };
}

async function main(argv) {
  const { values } = parseArgs(argv, { strings: ['platform', 'page', 'root'] });
  if (!values.platform) throw new UsageError('--platform is required.');
  if (values.page !== undefined && !PAGE_RE.test(values.page)) throw new UsageError('--page is not a valid page name.');
  const platform = resolvePlatform(resolveRoot(values.root), values.platform);
  if (!platform) throw new UsageError(`Platform folder not found: ${values.platform}`);

  const groups = snapshotsByPage(platform.dir);
  const pages = values.page === undefined ? [...groups.keys()] : groups.has(values.page) ? [values.page] : [];
  if (pages.length === 0) {
    write(values.page === undefined ? 'No snapshots.' : `No snapshots for ${values.page}.`);
    return EXIT.OK;
  }
  const sections = [];
  let failed = false;
  for (const page of pages) {
    const result = diffPage(page, groups.get(page));
    if (result.error) {
      failed = true;
      process.stderr.write(`Verification failed for ${page}: ${result.error}\n`);
    } else {
      sections.push(result.markdown);
    }
  }
  if (sections.length > 0) write(sections.join('\n\n'));
  return failed ? EXIT.CHECK_FAILED : EXIT.OK;
}

if (isMain(import.meta.url)) await runCli(() => main(process.argv.slice(2)));

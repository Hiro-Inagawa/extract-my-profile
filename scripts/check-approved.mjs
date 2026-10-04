// node check-approved.mjs [--platform <key>] [--root <dir>] [--sidecar <path>] [--json]
import path from 'node:path';
import { classifyText, loadSidecar, resolveSource } from './approved-lib.mjs';
import {
  EXIT,
  UsageError,
  isMain,
  latestSnapshots,
  listPlatforms,
  normalizeKey,
  parseArgs,
  resolveRoot,
  runCli,
  write,
} from './lib.mjs';

const STATUSES = ['present', 'differs', 'missing', 'no-snapshot', 'unknown-platform', 'source-unresolved'];
const CLOSEST_LIMIT = 300;

function clip(line) {
  return line.length > CLOSEST_LIMIT ? `${line.slice(0, CLOSEST_LIMIT)}...` : line;
}

function cell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** One result per (text, platform) pair. */
export function checkApproved({ root, sidecarPath, platformFilter }) {
  const sidecar = loadSidecar(sidecarPath);
  if (sidecar.state !== 'ok') throw new UsageError(sidecar.problems.join(' '));
  const platforms = new Map(listPlatforms(root).map((platform) => [platform.key, platform]));
  if (platformFilter && !platforms.has(platformFilter)) throw new UsageError(`Platform folder not found: ${platformFilter}`);

  const snapshotCache = new Map();
  const snapshotsOf = (platform) => {
    if (!snapshotCache.has(platform.key)) {
      snapshotCache.set(
        platform.key,
        latestSnapshots(platform.dir).filter((snapshot) => snapshot.parsed !== null),
      );
    }
    return snapshotCache.get(platform.key);
  };

  const results = [];
  for (const entry of sidecar.entries) {
    const source = resolveSource(entry, sidecarPath);
    for (const key of entry.platforms) {
      if (platformFilter && key !== platformFilter) continue;
      const base = { id: entry.id, platform: key, page: null, closest: '', similarity: 0 };
      const platform = platforms.get(key);
      if (!platform) {
        results.push({ ...base, status: 'unknown-platform' });
      } else if (!source.ok) {
        results.push({ ...base, status: 'source-unresolved', closest: source.detail });
      } else {
        const snapshots = snapshotsOf(platform);
        if (snapshots.length === 0) {
          results.push({ ...base, status: 'no-snapshot' });
        } else {
          const outcome = classifyText(source.text, snapshots);
          results.push({ ...base, ...outcome, closest: clip(outcome.closest) });
        }
      }
    }
  }
  return results;
}

export function renderTable(results) {
  const rows = results.map(
    (r) => `| ${cell(r.id)} | ${cell(r.platform)} | ${r.status} | ${cell(r.closest) || '-'} |`,
  );
  const counts = STATUSES.map((status) => `${results.filter((r) => r.status === status).length} ${status}`);
  return [
    '| Text | Platform | Status | Closest line |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    `Checked ${results.length} pair(s): ${counts.join(', ')}.`,
  ].join('\n');
}

async function main(argv) {
  const { values } = parseArgs(argv, { strings: ['platform', 'root', 'sidecar'], booleans: ['json'] });
  const root = resolveRoot(values.root);
  const sidecarPath = path.resolve(values.sidecar ?? path.join(root, 'APPROVED-PROFILE-TEXTS.json'));
  const results = checkApproved({
    root,
    sidecarPath,
    platformFilter: values.platform === undefined ? null : normalizeKey(values.platform),
  });
  write(values.json ? JSON.stringify(results, null, 2) : renderTable(results));
  return results.every((r) => r.status === 'present') ? EXIT.OK : EXIT.CHECK_FAILED;
}

if (isMain(import.meta.url)) await runCli(() => main(process.argv.slice(2)));

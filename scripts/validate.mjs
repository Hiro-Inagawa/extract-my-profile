// node validate.mjs [--root <dir>] [--platform <key>] [--approved-md <path>] [--sidecar <path>] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { loadSidecar, resolveSource } from './approved-lib.mjs';
import {
  EXIT,
  UsageError,
  isMain,
  listPlatforms,
  normalizeForMatch,
  normalizeKey,
  parseArgs,
  readText,
  resolveRoot,
  runCli,
  write,
} from './lib.mjs';
import { checkRegistry, checkTemplate } from './validate-checks.mjs';

const SIDECAR = '(sidecar)';

/** Sidecar agreement checks: schema, unique ids, known platforms, inline text in the Markdown, resume sources. */
export function checkSidecar({ sidecarPath, approvedMdPath, platformKeys }) {
  const findings = [];
  const add = (platform, code, detail) => findings.push({ platform, code, detail });
  const sidecar = loadSidecar(sidecarPath);
  if (sidecar.state === 'missing') {
    add(SIDECAR, 'SIDECAR_SCHEMA', sidecar.problems[0]);
    return findings;
  }
  for (const problem of sidecar.problems ?? []) add(SIDECAR, 'SIDECAR_SCHEMA', problem);
  if (!sidecar.entries) return findings;

  const approvedMd = fs.existsSync(approvedMdPath) ? normalizeForMatch(readText(approvedMdPath)) : null;
  const ids = new Set();
  for (const entry of sidecar.entries) {
    if (ids.has(entry.id)) add(SIDECAR, 'SIDECAR_DUPLICATE_ID', `Duplicate id "${entry.id}"`);
    ids.add(entry.id);
    for (const key of entry.platforms) {
      if (!platformKeys.has(key)) add(SIDECAR, 'SIDECAR_UNKNOWN_PLATFORM', `Text "${entry.id}" names an unknown platform: ${key}`);
    }
    if (entry.source.type === 'inline') {
      if (approvedMd === null) {
        add(SIDECAR, 'SIDECAR_TEXT_NOT_IN_MD', `Text "${entry.id}": approved Markdown not found: ${approvedMdPath}`);
      } else if (!approvedMd.includes(normalizeForMatch(entry.text))) {
        add(SIDECAR, 'SIDECAR_TEXT_NOT_IN_MD', `Text "${entry.id}" does not appear in the approved Markdown`);
      }
    } else {
      const source = resolveSource(entry, sidecarPath);
      if (!source.ok) add(SIDECAR, 'SIDECAR_RESUME_UNRESOLVED', `Text "${entry.id}": ${source.detail}`);
    }
  }
  return findings;
}

/** Runs every check. Returns {status, findings, checked} where checked lists the groups that ran. */
export function validateCollection({ root, platformFilter, sidecarPath, approvedMdPath }) {
  const all = listPlatforms(root);
  const platforms = platformFilter ? all.filter((p) => p.key === platformFilter) : all;
  if (platformFilter && platforms.length === 0) throw new UsageError(`Platform folder not found: ${platformFilter}`);

  const findings = [];
  const registryInput = [];
  for (const platform of platforms) {
    let lastVerified;
    if (platform.hasState) {
      const template = checkTemplate(platform);
      findings.push(...template.findings);
      lastVerified = template.lastVerified;
    }
    registryInput.push({ platform, lastVerified });
  }
  findings.push(...checkRegistry(path.join(root, 'PROFILES.md'), registryInput));
  findings.push(
    ...checkSidecar({ sidecarPath, approvedMdPath, platformKeys: new Set(all.map((p) => p.key)) }),
  );
  const checked = [...platforms.map((p) => p.key), SIDECAR];
  if (findings.some((f) => f.platform === '(collection)')) checked.push('(collection)');
  return { status: findings.length === 0 ? 'pass' : 'fail', findings, checked };
}

export function renderReport({ findings, checked }) {
  const lines = [];
  let passed = 0;
  for (const group of checked) {
    const own = findings.filter((f) => f.platform === group);
    if (own.length === 0) {
      passed += 1;
      lines.push(`PASS ${group}`);
      continue;
    }
    lines.push(`FAIL ${group} ${[...new Set(own.map((f) => f.code))].join(', ')}`);
    for (const finding of own) lines.push(`  - ${finding.code}: ${finding.detail}`);
  }
  lines.push('', `Summary: ${checked.length} checked, ${passed} passed, ${checked.length - passed} failed, ${findings.length} finding(s).`);
  return lines.join('\n');
}

async function main(argv) {
  const { values } = parseArgs(argv, { strings: ['root', 'platform', 'approved-md', 'sidecar'], booleans: ['json'] });
  const root = resolveRoot(values.root);
  const result = validateCollection({
    root,
    platformFilter: values.platform === undefined ? null : normalizeKey(values.platform),
    sidecarPath: path.resolve(values.sidecar ?? path.join(root, 'APPROVED-PROFILE-TEXTS.json')),
    approvedMdPath: path.resolve(values['approved-md'] ?? path.join(root, 'APPROVED-PROFILE-TEXTS.md')),
  });
  write(values.json ? JSON.stringify({ status: result.status, findings: result.findings }, null, 2) : renderReport(result));
  return result.status === 'pass' ? EXIT.OK : EXIT.CHECK_FAILED;
}

if (isMain(import.meta.url)) await runCli(() => main(process.argv.slice(2)));

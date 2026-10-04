// node capture-call.mjs [selector] [mode]
// Prints the exact text to paste into the browser tool's JavaScript call: the function from
// browser-capture.js without its leading comment block, wrapped as await (<function>)('<selector>'[, '<mode>']).
// Defaults: selector main, mode innertext. Exit 0 ok, 2 usage error.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODES = ['innertext', 'composed'];

export function captureCall(selector = 'main', mode = 'innertext') {
  if (typeof selector !== 'string' || selector === '') throw new Error('The selector must not be empty.');
  if (/['\\\r\n]/.test(selector)) throw new Error('The selector must not contain a single quote, a backslash or a line break.');
  if (!MODES.includes(mode)) throw new Error(`The mode must be one of: ${MODES.join(', ')}.`);
  const source = fs.readFileSync(new URL('./browser-capture.js', import.meta.url), 'utf8').replace(/^﻿/, '');
  const lines = source.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && (lines[start].startsWith('//') || lines[start].trim() === '')) start += 1;
  const fn = lines.slice(start).join('\n').trim();
  const modeArgument = mode === 'innertext' ? '' : `, '${mode}'`;
  return `await (${fn})('${selector}'${modeArgument})`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  try {
    if (args.length > 2) throw new Error('Usage: node scripts/capture-call.mjs [selector] [mode]');
    process.stdout.write(`${captureCall(args[0], args[1])}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

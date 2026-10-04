// node serve-example.mjs [--port <number>]
// A tiny static server for the example pages. Binds 127.0.0.1 only, serves only the examples folder,
// answers GET and HEAD, and refuses any path that leaves the folder. Node standard library only.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, UsageError, isMain, parseArgs, runCli, write } from './lib.mjs';

export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 4173;
export const EXAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** Maps a request URL to a file inside the examples folder, or null when it must be refused. */
export function resolveRequestPath(rawUrl, examplesDir = EXAMPLES_DIR) {
  // Look at the raw path before any URL normalization can fold '..' away.
  const rawPath = String(rawUrl).split(/[?#]/)[0];
  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (!pathname.startsWith('/') || pathname.includes(String.fromCharCode(0)) || pathname.includes(String.fromCharCode(92))) return null;
  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '..' || segment === '.')) return null;
  const candidate = path.resolve(examplesDir, ...segments);
  const relative = path.relative(examplesDir, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

export function createExampleServer(examplesDir = EXAMPLES_DIR) {
  const base = fs.realpathSync(examplesDir);
  return http.createServer((req, res) => {
    const send = (status, text) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : `${text}\n`);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed');
    const file = resolveRequestPath(req.url ?? '/', base);
    if (file === null) return send(403, 'Forbidden');
    let real;
    try {
      real = fs.realpathSync(file);
    } catch {
      return send(404, 'Not found');
    }
    // A link inside the folder that points outside it is refused too.
    if (path.relative(base, real).startsWith('..') || !fs.statSync(real).isFile()) return send(404, 'Not found');
    const body = fs.readFileSync(real);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(real).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

/** Starts the server on HOST. Port 0 picks a free port. Resolves with the listening server. */
export function startExampleServer({ port = DEFAULT_PORT, examplesDir = EXAMPLES_DIR } = {}) {
  const server = createExampleServer(examplesDir);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve(server));
  });
}

async function main(argv) {
  const { values } = parseArgs(argv, { strings: ['port'] });
  let port = DEFAULT_PORT;
  if (values.port !== undefined) {
    if (!/^\d{1,5}$/.test(values.port) || Number(values.port) > 65535) throw new UsageError('--port must be a number from 0 to 65535.');
    port = Number(values.port);
  }
  const server = await startExampleServer({ port }).catch((error) => {
    if (error.code === 'EADDRINUSE') throw new UsageError(`Port ${port} is in use. Choose another with --port.`);
    throw error;
  });
  const shown = server.address().port;
  write(`Serving ${EXAMPLES_DIR} at http://${HOST}:${shown}/`);
  write(`Example page: http://${HOST}:${shown}/demo-platform/profile-v1.html`);
  write('Press Ctrl+C to stop.');
  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  server.close();
  return EXIT.OK;
}

if (isMain(import.meta.url)) await runCli(() => main(process.argv.slice(2)));

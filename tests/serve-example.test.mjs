import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { EXAMPLES_DIR, HOST, resolveRequestPath, startExampleServer } from '../scripts/serve-example.mjs';
import { SCRIPTS } from './helpers.mjs';

function request(port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port, path, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(t) {
  const server = await startExampleServer({ port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server;
}

test('the server binds 127.0.0.1 on a port the test chose and serves the example pages as HTML', async (t) => {
  const server = await withServer(t);
  const { address, port } = server.address();
  assert.equal(address, '127.0.0.1');
  for (const name of ['profile-v1.html', 'profile-v2.html']) {
    const response = await request(port, `/demo-platform/${name}`);
    assert.equal(response.status, 200);
    assert.match(response.type, /^text\/html/);
    assert.equal(response.body, await readFile(join(EXAMPLES_DIR, 'demo-platform', name), 'utf8'));
  }
});

test('path traversal is refused in plain, encoded and backslash forms and nothing outside the folder is served', async (t) => {
  const server = await withServer(t);
  const { port } = server.address();
  const attempts = [
    '/../scripts/lib.mjs',
    '/demo-platform/../../scripts/lib.mjs',
    '/%2e%2e/scripts/lib.mjs',
    '/demo-platform/%2e%2e%2f%2e%2e%2fpackage.json',
    '/..%5cscripts%5clib.mjs',
    '/demo-platform/..%2f..%2fREADME.md',
    '/%00',
  ];
  for (const path of attempts) {
    const response = await request(port, path);
    assert.ok([403, 404].includes(response.status), `${path} gave ${response.status}`);
    assert.ok(!response.body.includes('export'), `${path} leaked a file`);
  }
  assert.equal((await request(port, '/../scripts/lib.mjs')).status, 403);
});

test('a missing file is 404, a folder is 404, and methods other than GET and HEAD are 405', async (t) => {
  const server = await withServer(t);
  const { port } = server.address();
  assert.equal((await request(port, '/demo-platform/none.html')).status, 404);
  assert.equal((await request(port, '/demo-platform/')).status, 404);
  assert.equal((await request(port, '/')).status, 404);
  assert.equal((await request(port, '/demo-platform/profile-v1.html', 'POST')).status, 405);
  const head = await request(port, '/demo-platform/profile-v1.html', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
});

test('resolveRequestPath keeps every result inside the examples folder', () => {
  assert.equal(resolveRequestPath('/demo-platform/profile-v1.html'), join(EXAMPLES_DIR, 'demo-platform', 'profile-v1.html'));
  assert.equal(resolveRequestPath('/demo-platform/profile-v1.html?x=1#y'), join(EXAMPLES_DIR, 'demo-platform', 'profile-v1.html'));
  for (const bad of ['/..', '/a/../../b', '/%2e%2e/x', '/a%5c..%5cb', '/a%00', '/%E0%A4%A']) assert.equal(resolveRequestPath(bad), null, bad);
});

test('the CLI rejects a bad port with exit 2 and reports a port that is in use', async (t) => {
  const exec = (port) => spawnSync(process.execPath, [join(SCRIPTS, 'serve-example.mjs'), '--port', port], { encoding: 'utf8' });
  assert.equal(exec('abc').status, 2);
  assert.equal(exec('70000').status, 2);
  const server = await withServer(t);
  const taken = exec(String(server.address().port));
  assert.equal(taken.status, 2);
  assert.match(taken.stderr, /in use/);
});

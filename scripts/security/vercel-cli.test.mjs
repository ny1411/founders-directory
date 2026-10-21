import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { vercelInvocation } from './vercel-cli.mjs';

test('Unix launches the CLI directly', () => {
  assert.deepEqual(vercelInvocation({ platform: 'linux' }), { command: 'vercel', prefix: [] });
});

test('Windows launches the npm-installed CLI with Node without a shell', () => {
  const bin = 'C:\\npm-bin';
  const expected = join(bin, 'node_modules', 'vercel', 'dist', 'vc.js');
  const found = new Set([join(bin, 'vercel.cmd'), expected]);
  assert.deepEqual(vercelInvocation({
    platform: 'win32', env: { Path: `C:\\other;${bin}` }, execPath: 'node.exe',
    exists: path => found.has(path),
  }), { command: 'node.exe', prefix: [expected] });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('Firebase Admin auth loads and resolves RSA signing keys without require(ESM)', () => {
  // Newer local Node releases otherwise hide the production ERR_REQUIRE_ESM.
  const result = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', `
    const assert = require('node:assert/strict');
    const { createRequire } = require('node:module');
    const { generateKeyPairSync, sign, verify } = require('node:crypto');
    const { getAuth } = require('firebase-admin/auth');
    assert.equal(typeof getAuth, 'function');

    // Resolve exactly the JWKS client used by Firebase Admin.
    const adminRequire = createRequire(require.resolve('firebase-admin/auth'));
    const jwksClient = adminRequire('jwks-rsa');
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'compat-test', alg: 'RS256', use: 'sig' };
    const client = jwksClient({
      jwksUri: 'https://example.invalid/jwks',
      fetcher: async () => ({ keys: [jwk] }),
    });
    (async () => {
      const key = await client.getSigningKey('compat-test');
      assert.equal(key.kid, 'compat-test');
      const payload = Buffer.from('firebase-admin-jwks-compatibility');
      const signature = sign('sha256', payload, privateKey);
      assert.equal(verify('sha256', payload, key.getPublicKey(), signature), true);
      assert.equal(verify('sha256', Buffer.from('tampered'), key.getPublicKey(), signature), false);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { encoding: 'utf8', timeout: 15_000 });

  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

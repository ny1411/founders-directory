import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as policy from '../../src/lib/bot-policy';
import * as imagePolicy from '../../src/lib/image-policy';
import { createBotProtectedPost } from '../../src/lib/bot-verification';

test('all four explicit BotID flag combinations and unset rollout defaults are diagnosed', () => {
  for (const [server, client, state] of [
    ['true', 'true', 'enabled'], ['false', 'false', 'disabled'],
    ['true', 'false', 'invalid'], ['false', 'true', 'invalid'],
    [undefined, undefined, 'disabled'], ['false', undefined, 'disabled'],
    [undefined, 'false', 'disabled'], ['true', undefined, 'invalid'],
    [undefined, 'true', 'invalid'],
  ] as const) {
    assert.equal(policy.botIdConfiguration(server, client).state, state);
  }
  for (const invalid of ['', 'TRUE', 'False', '1', 'secret-invalid-config']) {
    for (const [server, client] of [[invalid, 'false'], ['false', invalid], [invalid, invalid]]) {
      const logs: string[] = [];
      assert.throws(() => policy.diagnoseBotIdConfiguration(server, client, line => logs.push(line)), /Invalid BotID configuration/);
      assert.deepEqual(logs.map(line => JSON.parse(line)), [{ event: 'bot_configuration', state: 'invalid', reason: 'invalid_flag' }]);
      assert.ok(!logs.join('').includes(invalid === '' ? 'secret' : invalid));
    }
  }
  const logs: string[] = [];
  policy.diagnoseBotIdConfiguration('false', 'false', line => logs.push(line));
  assert.deepEqual(JSON.parse(logs[0]), { event: 'bot_configuration', state: 'disabled', reason: 'awaiting_rollout' });
});

test('the real Next startup configuration rejects a partial rollout before exporting the app config', () => {
  const source = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const [server, client, invalid] of [['true', 'false', true], ['false', 'true', true], ['true', 'true', false], ['false', 'false', false]] as const) {
    const exports: { default?: unknown } = {};
    const run = () => runInNewContext(compiled, {
      exports,
      process: { env: { BOTID_ENFORCEMENT_ENABLED: server, NEXT_PUBLIC_BOTID_ENABLED: client } },
      require(name: string) {
        if (name === 'botid/next/config') return { withBotId: (config: unknown) => config };
        if (name === './src/lib/bot-policy') return { diagnoseBotIdConfiguration: (a: string, b: string) => policy.diagnoseBotIdConfiguration(a, b, () => {}) };
        if (name === './src/lib/image-policy') return imagePolicy;
        throw new Error(`Unexpected import: ${name}`);
      },
    });
    if (invalid) { assert.throws(run, /Invalid BotID configuration/); assert.equal(exports.default, undefined); }
    else {
      run();
      const config = exports.default as { images: unknown; experimental: unknown };
      assert.ok(config);
      assert.equal(config.images, imagePolicy.IMAGE_CONFIG);
      assert.equal(config.experimental, imagePolicy.IMAGE_DECODER_CONFIG);
    }
  }
});

test('runtime configuration failures keep auth first and return retryable private 503 without body or downstream work', async () => {
  const saved = [process.env.BOTID_ENFORCEMENT_ENABLED, process.env.NEXT_PUBLIC_BOTID_ENABLED];
  try {
    for (const [server, client] of [['true', 'false'], ['false', 'true'], ['invalid-private-value', 'false']]) {
      process.env.BOTID_ENFORCEMENT_ENABLED = server;
      process.env.NEXT_PUBLIC_BOTID_ENABLED = client;
      for (const authenticated of [true, false]) {
        const events: string[] = [];
        const post = createBotProtectedPost({
          route: '/api/protected', requireProof: true,
          verifyToken: async () => { events.push('auth'); if (!authenticated) throw new Error('invalid token'); return { uid: 'fixture' }; },
          check: async () => { events.push('botid'); throw new Error('must not call provider'); },
          handler: async () => { events.push('downstream'); return Response.json({ ok: true }); },
        });
        const incoming = new Request('https://example.test/api/protected', { method: 'POST', headers: { authorization: 'Bearer fixture' }, body: 'private body' });
        const response = await post(incoming);
        assert.equal(response.status, authenticated ? 503 : 401);
        assert.deepEqual(events, ['auth']);
        assert.equal(incoming.bodyUsed, false);
        if (authenticated) {
          assert.equal(response.headers.get('cache-control'), 'private, no-store');
          assert.equal(response.headers.get('retry-after'), '30');
          assert.deepEqual(await response.json(), { error: 'Browser verification is temporarily unavailable. Try again later.', code: 'BOT_VERIFICATION_UNAVAILABLE' });
        }
      }
    }
  } finally {
    for (const [index, name] of ['BOTID_ENFORCEMENT_ENABLED', 'NEXT_PUBLIC_BOTID_ENABLED'].entries()) {
      if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index];
    }
  }
});

test('paired enabled configuration enforces proof and provider availability, while paired off permits the rollout', async () => {
  const saved = [process.env.BOTID_ENFORCEMENT_ENABLED, process.env.NEXT_PUBLIC_BOTID_ENABLED];
  try {
    for (const scenario of [
      { enabled: 'false', proof: false, unavailable: false, status: 200, events: ['auth', 'handler'] },
      { enabled: 'true', proof: false, unavailable: false, status: 403, events: ['auth'] },
      { enabled: 'true', proof: true, unavailable: false, status: 200, events: ['auth', 'botid', 'handler'] },
      { enabled: 'true', proof: true, unavailable: true, status: 503, events: ['auth', 'botid'] },
    ]) {
      process.env.BOTID_ENFORCEMENT_ENABLED = scenario.enabled;
      process.env.NEXT_PUBLIC_BOTID_ENABLED = scenario.enabled;
      const events: string[] = [];
      const post = createBotProtectedPost({
        route: '/api/protected', requireProof: true,
        verifyToken: async () => { events.push('auth'); return { uid: 'fixture' }; },
        check: async () => {
          events.push('botid');
          if (scenario.unavailable) throw new Error('private provider details');
          return { isHuman: true, isBot: false, isVerifiedBot: false, bypassed: false };
        },
        handler: async () => { events.push('handler'); return Response.json({ ok: true }); },
      });
      const headers = new Headers({ authorization: 'Bearer fixture' });
      if (scenario.proof) headers.set('x-is-human', JSON.stringify({ b: 1, v: 'fixture', e: 'fixture', d: 0 }));
      const incoming = new Request('https://example.test/api/protected', { method: 'POST', headers, body: 'private body' });
      assert.equal((await post(incoming)).status, scenario.status);
      assert.deepEqual(events, scenario.events);
      assert.equal(incoming.bodyUsed, false);
    }
  } finally {
    for (const [index, name] of ['BOTID_ENFORCEMENT_ENABLED', 'NEXT_PUBLIC_BOTID_ENABLED'].entries()) {
      if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index];
    }
  }
});

test('the real client initializes exactly once for all browser operations without reading the server flag', () => {
  const source = readFileSync(new URL('../../src/components/bot-id-protection.tsx', import.meta.url), 'utf8');
  assert.ok(!source.includes('BOTID_ENFORCEMENT_ENABLED'));
  assert.ok(!readFileSync(new URL('../../src/lib/bot-policy.ts', import.meta.url), 'utf8').includes('process.env'));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const enabled of ['true', 'false', undefined]) {
    const effects: Array<() => void> = [];
    const calls: unknown[] = [];
    const exports: { BotIdProtection?: () => null } = {};
    runInNewContext(compiled, {
      exports, process: { env: { NEXT_PUBLIC_BOTID_ENABLED: enabled } },
      require(name: string) {
        if (name === 'botid/client/core') return { initBotId: (config: unknown) => calls.push(config) };
        if (name === 'react') return { useEffect: (effect: () => void) => effects.push(effect) };
        if (name === '@/lib/bot-policy') return policy;
        throw new Error(`Unexpected import: ${name}`);
      },
    });
    assert.ok(exports.BotIdProtection);
    assert.equal(exports.BotIdProtection(), null);
    effects[0](); effects[0]();
    assert.equal(calls.length, enabled === 'true' ? 1 : 0);
    if (enabled === 'true') assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { protect: [
      { path: '/company/new', method: 'POST' },
      { path: '/api/enrich-contact', method: 'POST' },
      { path: '/api/extract-resume', method: 'POST' },
      { path: '/api/generate-dm', method: 'POST' },
    ] });
  }
  // The sole legitimate company-action caller submits from /company/new.
  const page = readFileSync(new URL('../../src/app/company/new/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /createCompany\(formData, idToken\)/);
  assert.match(page, /BotIdProtection/);
  for (const path of ['enrich-contact', 'extract-resume', 'generate-dm']) {
    const route = readFileSync(new URL(`../../src/app/api/${path}/route.ts`, import.meta.url), 'utf8');
    assert.match(route, /createBotProtectedPost/);
    assert.ok(route.includes(`/api/${path}`));
  }
});

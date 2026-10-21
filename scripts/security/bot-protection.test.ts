import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOT_VERIFICATION_REQUIRED_MESSAGE,
  BOT_VERIFICATION_UNAVAILABLE_MESSAGE,
  createBotProtectedPost,
  verifyBotRequest,
} from '../../src/lib/bot-verification';

const proof = JSON.stringify({ b: 1, v: 'fixture', e: 'fixture', d: 0 });

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost/protected', {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token', ...headers },
    body: 'private request body',
  });
}

test('missing and malformed proofs are rejected without contacting BotID', async () => {
  for (const value of [undefined, 'not-json', JSON.stringify({ b: 'wrong' })]) {
    let checks = 0;
    const headers = new Headers(value === undefined ? {} : { 'x-is-human': value });
    const result = await verifyBotRequest(headers, '/api/protected', {
      enabled: true,
      requireProof: true,
      check: async () => {
        checks += 1;
        return { isHuman: true, isBot: false, isVerifiedBot: false, bypassed: false };
      },
    });
    assert.equal(result.allowed, false);
    assert.equal(result.outcome, 'bot_rejected');
    assert.equal(result.status, 403);
    assert.equal(result.message, BOT_VERIFICATION_REQUIRED_MESSAGE);
    assert.equal(checks, 0);
  }
});

test('BotID classifications allow only a human result', async () => {
  const headers = new Headers({ 'x-is-human': proof });
  const human = await verifyBotRequest(headers, '/api/protected', {
    enabled: true,
    requireProof: true,
    check: async () => ({
      isHuman: true,
      isBot: false,
      isVerifiedBot: false,
      bypassed: false,
    }),
  });
  assert.deepEqual(human, { allowed: true, outcome: 'allowed' });

  for (const classification of [
    { isHuman: false, isBot: true, isVerifiedBot: false, bypassed: false },
    { isHuman: false, isBot: false, isVerifiedBot: true, bypassed: false },
  ]) {
    const result = await verifyBotRequest(headers, '/api/protected', {
      enabled: true,
      requireProof: true,
      check: async () => classification,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.outcome, 'bot_rejected');
    assert.equal(result.reason, 'suspicious');
  }
});

test('provider failures fail closed with a stable retryable response', async () => {
  const result = await verifyBotRequest(
    new Headers({ 'x-is-human': proof }),
    '/api/protected',
    {
      enabled: true,
      requireProof: true,
      check: async () => {
        throw new Error('private provider details');
      },
    },
  );
  assert.equal(result.allowed, false);
  assert.equal(result.outcome, 'verification_error');
  assert.equal(result.status, 503);
  assert.equal(result.message, BOT_VERIFICATION_UNAVAILABLE_MESSAGE);
});

test('BotID enforcement is default-off until the deployment flag is enabled', async () => {
  const previous = process.env.BOTID_ENFORCEMENT_ENABLED;
  const previousClient = process.env.NEXT_PUBLIC_BOTID_ENABLED;
  delete process.env.BOTID_ENFORCEMENT_ENABLED;
  delete process.env.NEXT_PUBLIC_BOTID_ENABLED;
  let checks = 0;
  try {
    const result = await verifyBotRequest(new Headers(), '/api/protected', {
      check: async () => {
        checks += 1;
        throw new Error('BotID must not run while disabled');
      },
    });
    assert.deepEqual(result, { allowed: true, outcome: 'allowed' });
    assert.equal(checks, 0);
  } finally {
    if (previous === undefined) delete process.env.BOTID_ENFORCEMENT_ENABLED;
    else process.env.BOTID_ENFORCEMENT_ENABLED = previous;
    if (previousClient === undefined) delete process.env.NEXT_PUBLIC_BOTID_ENABLED;
    else process.env.NEXT_PUBLIC_BOTID_ENABLED = previousClient;
  }
});

for (const route of [
  '/api/enrich-contact',
  '/api/extract-resume',
  '/api/generate-dm',
]) {
  test(`${route} rejects a bot after auth with zero database or provider work`, async () => {
    const events: string[] = [];
    const post = createBotProtectedPost({
      route,
      enabled: true,
      requireProof: true,
      verifyToken: async () => {
        events.push('auth');
        return { uid: 'verified-user' };
      },
      check: async () => {
        events.push('botid');
        return { isHuman: false, isBot: true, isVerifiedBot: false, bypassed: false };
      },
      handler: async () => {
        events.push('database');
        events.push('provider');
        return Response.json({ ok: true });
      },
    });
    const incoming = request({ 'x-is-human': proof });
    const response = await post(incoming);
    assert.equal(response.status, 403);
    assert.equal(incoming.bodyUsed, false);
    assert.deepEqual(events, ['auth', 'botid']);
    assert.deepEqual(await response.json(), {
      error: BOT_VERIFICATION_REQUIRED_MESSAGE,
      code: 'BOT_VERIFICATION_REQUIRED',
    });
  });
}

test('authentication remains independent and runs before BotID', async () => {
  let botChecks = 0;
  let downstream = 0;
  const post = createBotProtectedPost({
    route: '/api/protected',
    enabled: true,
    requireProof: true,
    verifyToken: async () => {
      throw new Error('expired token');
    },
    check: async () => {
      botChecks += 1;
      return { isHuman: true, isBot: false, isVerifiedBot: false, bypassed: false };
    },
    handler: async () => {
      downstream += 1;
      return Response.json({ ok: true });
    },
  });
  assert.equal((await post(request({ 'x-is-human': proof }))).status, 401);
  assert.equal(botChecks, 0);
  assert.equal(downstream, 0);
});

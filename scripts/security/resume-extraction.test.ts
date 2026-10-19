import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { createResumeExtractionHandler, MAX_RESUME_REQUEST_BYTES } from '../../src/lib/resume-extraction-handler';
import { MAX_RESUME_BYTES } from '../../src/lib/resume-upload';
import { reserveResumeExtractionAttempt, RESUME_USAGE_WINDOW_MS } from '../../src/lib/resume-extraction-usage';

function setup(options: { invalidToken?: boolean; limited?: boolean; usageDown?: boolean; modelFailure?: boolean } = {}) {
  const events: string[] = [];
  const handler = createResumeExtractionHandler({
    verifyToken: async (token) => {
      events.push(`verify:${token}`);
      if (options.invalidToken) throw new Error('sensitive credential details');
      return { uid: 'verified-user' };
    },
    reserveAttempt: async (uid) => {
      events.push(`reserve:${uid}`);
      if (options.usageDown) throw new Error('private database details');
      return { allowed: !options.limited, retryAfterSeconds: 123 };
    },
    extract: async (pdf) => {
      events.push(`model:${pdf.toString()}`);
      if (options.modelFailure) throw new Error('private provider details');
      return JSON.stringify({ name: 'Candidate' });
    },
  });
  return { handler, events };
}

function upload(options: { content?: string | Uint8Array; type?: string; token?: string | null } = {}) {
  const body = new FormData();
  const content = options.content instanceof Uint8Array ? new Uint8Array(options.content) : options.content ?? '%PDF-1.7\nfixture';
  body.append('file', new Blob([content], { type: options.type ?? 'application/pdf' }), 'resume.pdf');
  return new Request('http://localhost/api/extract-resume', {
    method: 'POST', body,
    headers: options.token === null ? {} : { authorization: `Bearer ${options.token ?? 'valid'}` },
  });
}

test('missing or invalid credentials reject before reading the upload or calling paid services', async () => {
  for (const invalidToken of [false, true]) {
    const { handler, events } = setup({ invalidToken });
    const request = upload({ token: invalidToken ? 'bad-token' : null });
    const response = await handler(request);
    assert.equal(response.status, 401);
    assert.equal(request.bodyUsed, false);
    assert.deepEqual(events, invalidToken ? ['verify:bad-token'] : []);
    assert.doesNotMatch(await response.text(), /sensitive/);
  }
});

test('valid PDF verifies identity, reserves allowance, then returns schema-validated structured output', async () => {
  const { handler, events } = setup();
  const response = await handler(upload());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { resume: { name: 'Candidate' } });
  assert.deepEqual(events, ['verify:valid', 'reserve:verified-user', 'model:%PDF-1.7\nfixture']);
});

test('successful extraction returns a private draft without persistence', async () => {
  const { handler } = setup();
  const response = await handler(upload());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { resume: { name: 'Candidate' } });
});

test('malformed or empty model extractions are never returned as usable resumes', async () => {
  for (const value of [{}, { name: 'Ada', skills: 42 }, { name: 'Ada', projects: 'wrong shape' }]) {
    const handler = createResumeExtractionHandler({
      verifyToken: async () => ({ uid: 'verified-user' }),
      reserveAttempt: async () => ({ allowed: true, retryAfterSeconds: 0 }),
      extract: async () => JSON.stringify(value),
    });
    assert.equal((await handler(upload())).status, 502);
  }
});

test('non-job profiles are rejected before the upload body or paid model is read', async () => {
  let modelCalls = 0;
  const handler = createResumeExtractionHandler({
    verifyToken: async () => ({ uid: 'verified-user' }),
    authorizeUpload: async () => false,
    reserveAttempt: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    extract: async () => { modelCalls++; return '{}'; },
  });
  const request = upload();
  assert.equal((await handler(request)).status, 409);
  assert.equal(request.bodyUsed, false);
  assert.equal(modelCalls, 0);
});

test('declared oversized body rejects before it is read', async () => {
  const { handler, events } = setup();
  const request = upload();
  request.headers.set('content-length', String(MAX_RESUME_REQUEST_BYTES + 1));
  assert.equal((await handler(request)).status, 413);
  assert.equal(request.bodyUsed, false);
  assert.deepEqual(events, ['verify:valid']);
});

test('streamed body exceeding cap is cancelled even without content length', async () => {
  let cancelled = false;
  const { handler, events } = setup();
  const request = new Request('http://localhost/api/extract-resume', {
    method: 'POST',
    headers: { authorization: 'Bearer valid', 'content-type': 'multipart/form-data; boundary=test' },
    body: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MAX_RESUME_REQUEST_BYTES + 1)); },
      cancel() { cancelled = true; },
    }),
    duplex: 'half',
  } as RequestInit);
  assert.equal((await handler(request)).status, 413);
  assert.equal(cancelled, true);
  assert.deepEqual(events, ['verify:valid']);
});

test('oversized PDF, incorrect MIME, forged signature, and empty PDF never consume allowance', async () => {
  for (const [options, status] of [
    [{ content: new Uint8Array(MAX_RESUME_BYTES + 1) }, 413],
    [{ type: 'text/plain' }, 415],
    [{ content: 'not actually a PDF' }, 415],
    [{ content: new Uint8Array([0xa5, 0xd0, 0xc4, 0xc6, 0xad]) }, 415],
    [{ content: '' }, 415],
  ] as const) {
    const { handler, events } = setup();
    assert.equal((await handler(upload(options))).status, status);
    assert.deepEqual(events, ['verify:valid']);
  }
});

test('missing, duplicate, or text file field and malformed multipart produce 400', async () => {
  const bodies = [new FormData(), new FormData(), new FormData()];
  bodies[1].append('file', 'pretend file');
  bodies[2].append('file', new Blob(['%PDF-fixture'], { type: 'application/pdf' }), 'a.pdf');
  bodies[2].append('file', new Blob(['%PDF-fixture'], { type: 'application/pdf' }), 'b.pdf');
  const requests = bodies.map((body) => new Request('http://localhost', {
    method: 'POST', headers: { authorization: 'Bearer valid' }, body,
  }));
  requests.push(new Request('http://localhost', {
    method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'multipart/form-data; boundary=broken' }, body: 'broken',
  }));
  for (const request of requests) {
    const { handler, events } = setup();
    assert.equal((await handler(request)).status, 400);
    assert.deepEqual(events, ['verify:valid']);
  }
});

test('rate rejection returns Retry-After; rate-store failure fails closed without paid calls', async () => {
  for (const options of [{ limited: true }, { usageDown: true }]) {
    const { handler, events } = setup(options);
    const response = await handler(upload());
    assert.equal(response.status, options.limited ? 429 : 503);
    if (options.limited) assert.equal(response.headers.get('retry-after'), '123');
    assert.deepEqual(events, ['verify:valid', 'reserve:verified-user']);
    assert.doesNotMatch(await response.text(), /private/);
  }
});

test('model failure returns a safe error without saving or exposing provider details', async () => {
  const { handler } = setup({ modelFailure: true });
  const response = await handler(upload());
  assert.equal(response.status, 502);
  const payload = await response.text();
  assert.match(payload, /existing resume is unchanged/);
  assert.doesNotMatch(payload, /private provider/);
});

test('transactional allowance persists per user across handler instances and resets after its window', async () => {
  const records = new Map<string, Record<string, number>>();
  const db = {
    collection: (name: string) => {
      assert.equal(name, 'resumeExtractionUsage');
      return { doc: (key: string) => key };
    },
    runTransaction: async (fn: (transaction: unknown) => unknown) => fn({
      get: async (key: string) => ({ data: () => records.get(key) }),
      set: (key: string, data: Record<string, number>) => records.set(key, data),
    }),
  } as unknown as Firestore;
  const startsAt = 1000;
  for (let index = 0; index < 5; index++) {
    assert.equal((await reserveResumeExtractionAttempt(db, 'user/one', () => startsAt + index)).allowed, true);
  }
  assert.deepEqual(await reserveResumeExtractionAttempt(db, 'user/one', () => startsAt + 1000), {
    allowed: false, retryAfterSeconds: 599,
  });
  assert.equal((await reserveResumeExtractionAttempt(db, 'user/two', () => startsAt + 1000)).allowed, true);
  assert.equal((await reserveResumeExtractionAttempt(db, 'user/one', () => startsAt + RESUME_USAGE_WINDOW_MS)).allowed, true);
  assert.equal(records.size, 2);
});

test('out-of-order instance clocks cannot reset an active usage window', async () => {
  let record: Record<string, number> | undefined;
  const db = {
    collection: () => ({ doc: () => 'user' }),
    runTransaction: async (fn: (transaction: unknown) => unknown) => fn({
      get: async () => ({ data: () => record }),
      set: (_key: string, data: Record<string, number>) => { record = data; },
    }),
  } as unknown as Firestore;
  const results = [];
  for (const time of [1005, 1004, 1003, 1002, 1001, 1000, 999]) {
    results.push((await reserveResumeExtractionAttempt(db, 'user', () => time)).allowed);
  }
  assert.deepEqual(results, [true, true, true, true, true, false, false]);
  assert.deepEqual(record, { startsAt: 1005, attempts: 5 });
});

test('transaction retry evaluates the clock after reading current persisted state', async () => {
  const events: string[] = [];
  const db = {
    collection: () => ({ doc: () => 'user' }),
    runTransaction: async (fn: (transaction: unknown) => unknown) => {
      // Firestore may rerun the callback after another transaction commits.
      for (let attempt = 0; attempt < 2; attempt++) {
        await fn({
          get: async () => { events.push('read'); return { data: () => undefined }; },
          set: () => { events.push('write'); },
        });
      }
      return { allowed: true, retryAfterSeconds: 600 };
    },
  } as unknown as Firestore;
  await reserveResumeExtractionAttempt(db, 'user', () => { events.push('clock'); return 1000; });
  assert.deepEqual(events, ['read', 'clock', 'write', 'read', 'clock', 'write']);
});

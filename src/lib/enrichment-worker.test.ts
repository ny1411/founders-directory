import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEnrichmentProcessor} from './enrichment-worker';
import type {EnrichmentJob} from './enrichment-handler';
import type {Company, Founder} from './types';

const jobId = 'a'.repeat(64);
function fixture(status: EnrichmentJob['status'] = 'queued') {
  const job: EnrichmentJob = {
    uid: 'owner', founderIds: ['one'], companySlug: 'company', status,
    createdAt: Date.now(), expiresAt: Date.now() + 900_000, userLease: 'user-token',
    ...(status === 'polling' ? {requestId: 'upstream-request', polls: 0} : {}),
  };
  let enabled = true;
  const locks = new Map<string, string>();
  const requests: {path: string; init?: RequestInit}[] = [];
  const enqueued: number[] = [];
  const releases: string[] = [];
  type ProviderResult = Awaited<ReturnType<Parameters<typeof createEnrichmentProcessor>[0]['provider']>>;
  let response: ProviderResult = {payload: {requestId: 'upstream-request'}};
  let providerError = false;
  let hold: Promise<void> | undefined;
  let holdUpdate: Promise<void> | undefined;
  let updating = false;
  const process = createEnrichmentProcessor({
    enabled: () => enabled,
    get: async () => ({...job}),
    update: async (_id, update, token) => {
      updating = true;
      if (holdUpdate) await holdUpdate;
      if (locks.get(`enrichment-job:${jobId}`) !== token) return false;
      Object.assign(job, update); return true;
    },
    claimSubmission: async () => {if(job.status !== 'queued') return false; job.status = 'submitting'; return true;},
    targets: async () => ({
      company: {id: 'company', website: 'https://company.example'} as Company,
      founders: [{id: 'one', companyId: 'company', name: 'One Founder', linkedinUrl: 'https://linkedin.com/in/one'} as Founder],
    }),
    acquire: async key => {
      if (locks.has(key)) return null;
      locks.set(key, 'worker-token');
      return 'worker-token';
    },
    release: async (key, token) => {
      releases.push(key);
      if (locks.get(key) === token) locks.delete(key);
    },
    enqueue: async (_id, step) => { enqueued.push(step); },
    runPaid: async (_units, submit) => submit(() => {}),
    provider: async (path, init) => {
      requests.push({path, init});
      if (init?.method === 'POST') assert.equal(job.status, 'submitting', 'intent must be durable before the paid POST');
      if (hold) await hold;
      if (providerError) throw new DOMException('timeout', 'TimeoutError');
      return response;
    },
  });
  return {
    process, job, requests, enqueued, releases,
    respond: (value: ProviderResult) => { response = value; },
    failProvider: () => { providerError = true; },
    disable: () => { enabled = false; },
    holdProvider: (value: Promise<void>) => { hold = value; },
    holdUpdate: (value: Promise<void>) => { holdUpdate = value; },
    updating: () => updating,
  };
}

test('paid submission is persisted before provider call and redelivery only polls', async () => {
  const f = fixture();
  await f.process(jobId);
  assert.equal(f.job.status, 'polling');
  assert.equal(f.job.requestId, 'upstream-request');
  assert.deepEqual(f.enqueued, [1]);
  f.respond({payload: {status: 'pending'}});
  await f.process(jobId);
  assert.equal(f.requests.filter(request => request.init?.method === 'POST').length, 1);
  assert.equal(f.job.polls, 1);
});

test('ambiguous paid timeout is terminal and cannot submit again', async () => {
  const f = fixture(); f.failProvider();
  await f.process(jobId);
  assert.equal(f.job.status, 'failed');
  await f.process(jobId);
  assert.equal(f.requests.length, 1);
  assert.ok(f.releases.includes('enrichment-user:owner'));
});

test('redelivery after crash in submitting state does not repeat paid POST', async () => {
  const f = fixture('submitting');
  await f.process(jobId);
  assert.equal(f.job.status, 'failed');
  assert.equal(f.job.reason, 'SUBMISSION_UNCERTAIN');
  assert.equal(f.requests.length, 0);
});

test('concurrent duplicate delivery cannot perform a second paid submission', async () => {
  const f = fixture();
  let resume!: () => void;
  f.holdProvider(new Promise<void>(resolve => { resume = resolve; }));
  const first = f.process(jobId);
  while (!f.requests.length) await new Promise<void>(resolve => setImmediate(resolve));
  await assert.rejects(f.process(jobId), /JOB_BUSY/);
  resume();
  await first;
  assert.equal(f.requests.length, 1);
});

test('fifteen unsuccessful polls terminate with no sixteenth upstream request', async () => {
  const f = fixture('polling');
  f.respond({payload: {status: 'pending'}});
  for (let attempt = 0; attempt < 16; attempt++) await f.process(jobId);
  assert.equal(f.requests.length, 15);
  assert.equal(f.job.status, 'failed');
  assert.equal(f.job.reason, 'POLLING_TIMEOUT');
});

test('provider GET failures consume bounded polling allowance', async () => {
  const f = fixture('polling'); f.failProvider();
  for (let attempt = 0; attempt < 16; attempt++) await f.process(jobId);
  assert.equal(f.requests.length, 15);
  assert.equal(f.job.status, 'failed');
});

test('malformed completed result cannot strand polling or expose raw provider data', async () => {
  const f = fixture('polling');
  f.respond({payload: {status: 'completed', results: [{linkedin_url: 'https://linkedin.com/in/one', emails: {email: 'secret@example.com'}, secret: 'private-provider-field'}, null]}});
  await f.process(jobId);
  assert.equal(f.job.status, 'completed');
  assert.equal(JSON.stringify(f.job.results).includes('private-provider-field'), false);
  assert.equal(JSON.stringify(f.job.results).includes('secret@example.com'), false);
});

test('completed contact result includes founder identity and only the validated email', async () => {
  const f = fixture('polling');
  f.respond({payload: {status: 'completed', results: [{linkedin_url: 'https://linkedin.com/in/one', emails: [{verificationStatus: 'valid', email: 'one@example.com'}], phone: 'private-phone'}]}});
  await f.process(jobId);
  assert.deepEqual(f.job.results, [{founderId: 'one', workEmail: 'one@example.com'}]);
});

test('expired jobs fail without spending provider credits', async () => {
  const f = fixture(); f.job.expiresAt = Date.now() - 1;
  await f.process(jobId);
  assert.equal(f.job.reason, 'JOB_EXPIRED');
  assert.equal(f.requests.length, 0);
});

test('disabled enrichment cannot submit an existing queued job', async () => {
  const f = fixture(); f.disable();
  await assert.rejects(f.process(jobId), /ENRICHMENT_DISABLED/);
  assert.equal(f.requests.length, 0);
});

for (const status of ['polling', 'submitting'] as const) {
  test(`terminal ${status} processing retains the worker lease throughout a delayed commit`, async () => {
    const f = fixture(status);
    f.respond({payload: {status: 'completed', results: []}});
    let commit!: () => void;
    f.holdUpdate(new Promise<void>(resolve => { commit = resolve; }));
    const running = f.process(jobId);
    while (!f.updating()) await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(f.releases, [], 'finally must not release worker ownership while the terminal transaction waits');
    commit();
    await running;
    assert.equal(f.job.status, status === 'polling' ? 'completed' : 'failed');
    assert.deepEqual(f.releases, ['enrichment-user:owner', `enrichment-job:${jobId}`]);
  });
}

test('slow queued target reads retry an unclaimed job and submit only once under fresh ownership', async () => {
  let now = Date.now();
  const job: EnrichmentJob = {uid: 'owner', founderIds: ['one'], companySlug: 'company', status: 'queued',
    createdAt: now, expiresAt: now + 900_000, userLease: 'user-token'};
  let owner: {token: string; expiresAt: number};
  let deliveries = 0;
  let reads = 0;
  let reservations = 0;
  let paid = 0;
  const enqueued: number[] = [];
  const worker = createEnrichmentProcessor({
    enabled: () => true, clock: () => now, get: async () => ({...job}),
    acquire: async (_key, ttl) => {owner = {token: `delivery-${++deliveries}`, expiresAt: now + ttl}; return owner.token;},
    update: async (_id, value, token) => {
      if (owner.token !== token || owner.expiresAt <= now) return false;
      Object.assign(job, value); return true;
    },
    release: async key => {assert.ok(key.startsWith('enrichment-job:'), 'unsubmitted/polling work must retain the user lease');},
    claimSubmission: async (_id, token) => {
      if (owner.token !== token || owner.expiresAt <= now + 15_000 || job.status !== 'queued') return false;
      job.status = 'submitting'; return true;
    },
    targets: async () => {
      if (++reads === 1) now += 76_000;
      return {company: {} as Company, founders: [{id: 'one', name: 'One Founder'} as Founder]};
    },
    runPaid: async (_units, submit) => {reservations++; return submit(() => {});},
    provider: async () => {paid++; return {payload: {requestId: 'one-paid-request'}};},
    enqueue: async (_id, step) => {enqueued.push(step);},
  });
  await assert.rejects(worker(jobId), /^Error: JOB_OWNERSHIP_LOST$/);
  assert.equal(job.status, 'queued');
  assert.equal(reservations, 0);
  assert.equal(paid, 0);
  assert.deepEqual(enqueued, []);
  await worker(jobId);
  assert.equal(job.status, 'polling');
  assert.equal(reservations, 1);
  assert.equal(paid, 1);
  assert.deepEqual(enqueued, [1]);
});

for (const staleOutcome of ['pending', 'completed', 'target-missing', 'paid-submission'] as const) {
  test(`an expired ${staleOutcome} delivery cannot overwrite its replacement or enqueue/release owner work`, async () => {
    let now = Date.now();
    const job: EnrichmentJob = {
      uid: 'owner', founderIds: ['one'], companySlug: 'company',
      status: staleOutcome === 'paid-submission' ? 'queued' : 'polling',
      requestId: 'upstream-request', polls: 3, createdAt: now, expiresAt: now + 900_000, userLease: 'user-token',
    };
    let owner: {token: string; expiresAt: number} | undefined;
    let serial = 0;
    let providerCalls = 0;
    let targetCalls = 0;
    let resume!: () => void;
    let begin!: () => void;
    const held = new Promise<void>(resolve => { resume = resolve; });
    const started = new Promise<void>(resolve => { begin = resolve; });
    const userReleases: string[] = [];
    const enqueued: number[] = [];
    const worker = createEnrichmentProcessor({
      enabled: () => true, clock: () => now, get: async () => ({...job}),
      acquire: async (_key, ttl) => {
        if (owner && owner.expiresAt > now) return null;
        owner = {token: `worker-${++serial}`, expiresAt: now + ttl};
        return owner.token;
      },
      update: async (_id, value, token) => {
        if (owner?.token !== token || owner.expiresAt <= now || ['completed', 'failed'].includes(job.status)) return false;
        Object.assign(job, value);
        return true;
      },
      claimSubmission: async (_id, token) => {
        if (owner?.token !== token || owner.expiresAt <= now || job.status !== 'queued') return false;
        job.status = 'submitting'; return true;
      },
      release: async (key, token) => {
        if (key.startsWith('enrichment-user:')) userReleases.push(token);
        else if (owner?.token === token) owner = undefined;
      },
      targets: async () => {
        targetCalls++;
        if (staleOutcome === 'target-missing' && targetCalls === 2) return null;
        return {company: {website: 'https://company.example'} as Company,
          founders: [{id: 'one', name: 'One Founder', linkedinUrl: 'https://linkedin.com/in/one'} as Founder]};
      },
      runPaid: async (_units, submit) => submit(() => {}),
      provider: async () => {
        const first = ++providerCalls === 1;
        if (first) { begin(); await held; }
        if (staleOutcome === 'paid-submission') return {payload: {requestId: 'paid-request'}};
        if (first && staleOutcome === 'pending') return {payload: {status: 'pending'}};
        return {payload: {status: 'completed', results: [{linkedin_url: 'https://linkedin.com/in/one', email: first ? 'stale@example.com' : 'current@example.com'}]}};
      },
      enqueue: async (_id, step) => { enqueued.push(step); },
    });
    const stale = worker(jobId);
    await started;
    now += 90_001;
    await worker(jobId);
    const replacementState = structuredClone(job);
    resume();
    await assert.rejects(stale, /^Error: JOB_OWNERSHIP_LOST$/);
    assert.deepEqual(job, replacementState, 'late provider data cannot regress the committed replacement state');
    assert.equal(job.status, staleOutcome === 'paid-submission' ? 'failed' : 'completed');
    if (staleOutcome !== 'paid-submission') assert.deepEqual(job.results, [{founderId: 'one', workEmail: 'current@example.com'}]);
    assert.deepEqual(enqueued, [], 'stale deliveries cannot extend polling');
    assert.deepEqual(userReleases, ['user-token'], 'only the winning completion releases owner work');
    assert.equal(providerCalls, staleOutcome === 'paid-submission' ? 1 : 2);
  });
}

test('ownership loss during a slow target read requests redelivery instead of stranding the job', async () => {
  let now = Date.now();
  const job: EnrichmentJob = {uid: 'owner', founderIds: ['one'], companySlug: 'company', status: 'polling',
    requestId: 'upstream-request', polls: 2, createdAt: now, expiresAt: now + 900_000, userLease: 'user-token'};
  let owner: {token: string; expiresAt: number};
  let deliveries = 0;
  let reads = 0;
  let finishRead!: () => void;
  let begin!: () => void;
  const held = new Promise<void>(resolve => { finishRead = resolve; });
  const started = new Promise<void>(resolve => { begin = resolve; });
  let released = 0;
  const worker = createEnrichmentProcessor({
    enabled: () => true, clock: () => now, get: async () => ({...job}),
    acquire: async (_key, ttl) => {owner = {token: `delivery-${++deliveries}`, expiresAt: now + ttl}; return owner.token;},
    update: async (_id, value, token) => {
      if (owner.token !== token || owner.expiresAt <= now) return false;
      Object.assign(job, value); return true;
    },
    release: async key => {if (key.startsWith('enrichment-user:')) released++;},
    claimSubmission: async () => assert.fail('polling never claims another paid submission'),
    runPaid: async () => assert.fail('polling never reserves another paid attempt'),
    targets: async () => {
      if (++reads === 1) {begin(); await held;}
      return {company: {} as Company, founders: [{id: 'one', name: 'One Founder', linkedinUrl: 'https://linkedin.com/in/one'} as Founder]};
    },
    provider: async () => ({payload: {status: 'completed', results: [{linkedin_url: 'https://linkedin.com/in/one', email: 'one@example.com'}]}}),
    enqueue: async () => assert.fail('completed or stale work must not enqueue another poll'),
  });
  const first = worker(jobId);
  await started;
  now += 90_001;
  finishRead();
  await assert.rejects(first, /^Error: JOB_OWNERSHIP_LOST$/);
  assert.equal(job.status, 'polling');
  assert.equal(released, 0);
  await worker(jobId); // Queue retry obtains a fresh lease and safely completes.
  assert.equal(job.status, 'completed');
  assert.deepEqual(job.results, [{founderId: 'one', workEmail: 'one@example.com'}]);
  assert.equal(released, 1);
});

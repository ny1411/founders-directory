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
  const process = createEnrichmentProcessor({
    enabled: () => enabled,
    get: async () => ({...job}),
    update: async (_id, update) => { Object.assign(job, update); },
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

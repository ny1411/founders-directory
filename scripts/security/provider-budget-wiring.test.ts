import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {providerBudgetConfig, withProviderBudget, type PaidOperation, ProviderBudgetError} from '../../src/lib/provider-budget';
import {createEnrichmentProcessor} from '../../src/lib/enrichment-worker';
import type {EnrichmentJob} from '../../src/lib/enrichment-handler';
import type {Company, Founder} from '../../src/lib/types';
import {memoryBudgetDb} from './provider-budget-fixture';
import {hashIdentity} from '../../src/lib/rate-limit';

function load(relative: string, imports: Record<string, unknown>) {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(compiled, {exports: {}, process: {env: {}}, Date, console, require(name: string) {
    assert.ok(name in imports, `Unexpected production import ${name}`); return imports[name];
  }});
}

test('both production Gemini routes reserve before SDK submission with a single bounded SDK attempt', async () => {
  for (const operation of ['dm', 'resume'] as const) {
    const f = memoryBudgetDb(); let captured: Record<string, (...args: unknown[]) => Promise<unknown>> | undefined;
    let calls = 0; let killed = false; let delayedBudget = false; let ownerExpired = false;
    const wrap = (db: typeof f.db, actual: PaidOperation, work: () => Promise<unknown>, units?: number) => {
      assert.equal(db, f.db); assert.equal(actual, operation);
      return withProviderBudget(db, actual, async () => {if (delayedBudget) ownerExpired = true; return work();}, units, {config: () => ({...providerBudgetConfig({}), enabled: !killed})});
    };
    class GoogleGenAI {
      models = {generateContent: async (input: {config: {httpOptions: object; maxOutputTokens: number}}) => {
        calls++; assert.equal(f.units().length, 4);
        assert.equal(input.config.maxOutputTokens, operation === 'resume' ? 8192 : 1024);
        assert.ok(f.units().every(units => units === (operation === 'resume' ? 5 : 1)), 'reservation precedes paid SDK call');
        assert.equal(input.config.httpOptions && JSON.stringify(input.config.httpOptions), JSON.stringify({timeout: 60000, retryOptions: {attempts: 1}}));
        return {text: 'safe model result'};
      }};
    }
    const capture = (deps: typeof captured) => {captured = deps; return async () => new Response();};
    load(`../../src/app/api/${operation === 'dm' ? 'generate-dm' : 'extract-resume'}/route.ts`, {
      '@google/genai': {GoogleGenAI}, '@/lib/firebase-admin': {adminDb: f.db, adminAuth: {}},
      '@/lib/onboarding/store': {OnboardingStore: class {}},
      '@/lib/bot-verification': {createBotProtectedPost: (value: {handler: unknown}) => value.handler},
      '@/lib/observability-runtime': {instrumentApiRoute: (_config: unknown, handler: unknown) => handler},
      '@/lib/provider-budget': {withProviderBudget: wrap},
      ...(operation === 'dm' ? {
        '@/lib/onboarding/messages': {createMessageHandler: capture}, '@/lib/rate-limit': {},
      } : {
        '@/lib/resume-extraction-handler': {createResumeExtractionHandler: capture, RESUME_EXTRACTION_LEASE_MS: 120000},
        '@/lib/rate-limit': {
          acquireLease: async (db: unknown, key: string, ttl: number) => {assert.equal(db, f.db); assert.equal(key, 'resume-extraction:verified-owner'); assert.equal(ttl,120000); return 'owner-token';},
          releaseLease: async (db: unknown, key: string, token: string) => {assert.equal(db, f.db); assert.equal(key, 'resume-extraction:verified-owner'); assert.equal(token,'owner-token');},
        },
        '@/lib/resume-extraction-usage': {}, '@/lib/admission-policy': {createAdmissionCheck: () => {}},
      }),
    });
    if (operation === 'resume') {
      assert.equal(await captured!.acquire('verified-owner'), 'owner-token');
      await captured!.release('verified-owner', 'owner-token');
    }
    const submit = () => operation === 'dm' ? captured!.generate({instructions: 'safe', data: {}}) : captured!.extract(Buffer.from('%PDF-1.4'), () => {if (ownerExpired) throw new ProviderBudgetError(503, 'concurrency', 30);});
    assert.equal(await submit(), 'safe model result'); assert.equal(calls, 1);
    killed = true; await assert.rejects(submit(), {status: 503}); assert.equal(calls, 1);
    if (operation === 'resume') {
      killed = false; delayedBudget = true;
      await assert.rejects(submit(), {status:503});
      assert.equal(ownerExpired, true); assert.equal(calls,1, 'expired owner lease must not start SDK after delayed global reservation');
    }
  }
});

test('production enrichment wiring uses shared budgets and founder-count units', async () => {
  const f = memoryBudgetDb(); let captured: {runPaid: (units: number, submit: () => Promise<string>) => Promise<string>; claimSubmission: (id: string, token: string) => Promise<boolean>} | undefined;
  load('../../src/lib/enrichment-jobs.ts', {
    '@vercel/queue': {}, './firebase-admin': {adminDb: f.db},
    './enrichment-handler': {createEnrichmentHandlers: () => ({})}, './rate-limit': {hashIdentity}, './saleshandy': {},
    './enrichment-worker': {createEnrichmentProcessor: (deps: typeof captured) => {captured = deps;}},
    './enrichment-callback': {},
    './provider-budget': {withProviderBudget: (db: typeof f.db, operation: PaidOperation, submit: () => Promise<string>, units: number) => {
      assert.equal(db, f.db); assert.equal(operation, 'enrichment'); return withProviderBudget(db, operation, submit, units);
    }},
  });
  const jobId = 'a'.repeat(64);
  const jobPath = `contactEnrichmentJobs/${jobId}`; const leasePath = `apiLeases/${hashIdentity(`enrichment-job:${jobId}`)}`;
  f.values.set(jobPath, {status: 'queued'}); f.values.set(leasePath, {token: 'owner', expiresAt: Date.now() + 90000});
  assert.equal(await captured!.claimSubmission(jobId, 'stale'), false);
  assert.equal(await captured!.claimSubmission(jobId, 'owner'), true);
  assert.equal(await captured!.claimSubmission(jobId, 'owner'), false);
  assert.equal(f.values.get(jobPath)?.status, 'submitting');
  f.values.set(jobPath, {status: 'queued'}); f.values.set(leasePath, {token: 'owner', expiresAt: Date.now() + 1000});
  assert.equal(await captured!.claimSubmission(jobId, 'owner'), false);
  assert.equal(await captured!.runPaid(4, async () => {assert.deepEqual(f.units(), [4, 4, 4, 4]); return 'submitted';}), 'submitted');
});

test('real worker + durable budget reject before POST, while retries and GET polls never reserve again', async () => {
  const f = memoryBudgetDb(); let limits = providerBudgetConfig({}); limits.project.hourly = 1;
  const job = {uid: 'owner', founderIds: ['one', 'two'], companySlug: 'company', status: 'queued', createdAt: Date.now(), expiresAt: Date.now() + 900_000, userLease: 'token'} as EnrichmentJob;
  const states: string[] = []; const methods: string[] = []; let reservations = 0; const now = Date.now();
  const worker = createEnrichmentProcessor({
    enabled: () => true, get: async () => ({...job}),
    update: async (_id, value) => {states.push(value.status || 'poll'); Object.assign(job, value);},
    claimSubmission: async () => {if(job.status !== 'queued') return false; job.status = 'submitting'; return true;},
    targets: async () => ({company: {website: 'https://company.example'} as Company, founders: [{name: 'One', linkedinUrl: 'https://linkedin.com/in/one'} as Founder]}),
    acquire: async () => 'lock', release: async () => {}, enqueue: async () => {},
    runPaid: (units, submit) => {reservations++; return withProviderBudget(f.db, 'enrichment', submit, units, {config: () => limits, clock: () => now});},
    provider: async (_path, init) => {methods.push(init?.method || 'GET'); assert.equal(job.status, init?.method === 'POST' ? 'submitting' : 'polling'); return {payload: {requestId: 'request', status: 'pending'}};},
  });
  await worker('a'.repeat(64));
  assert.deepEqual(states, ['failed']); assert.equal(job.reason, 'PROVIDER_BUDGET_REJECTED'); assert.equal(methods.length, 0); assert.equal(f.values.size, 0);
  limits = providerBudgetConfig({}); job.status = 'queued'; job.founderIds = ['one']; states.length = 0;
  await worker('a'.repeat(64)); await worker('a'.repeat(64)); await worker('a'.repeat(64));
  assert.deepEqual(methods, ['POST', 'GET', 'GET']); assert.equal(reservations, 2); assert.deepEqual(f.units(), [1, 1, 1, 1]);
});


test('delayed stale worker cannot claim or spend after replacement delivery submits', async () => {
  const f = memoryBudgetDb(); const job = {uid: 'owner', founderIds: ['one'], companySlug: 'company', status: 'queued', createdAt: Date.now(), expiresAt: Date.now() + 900_000, userLease: 'user-token'} as EnrichmentJob;
  let currentOwner = 'first'; let paid = 0; let reservations = 0; let resolveTargets!: () => void; let targetReads = 0;
  const target = {company: {website: 'https://company.example'} as Company, founders: [{name: 'One'} as Founder]};
  const heldTargets = new Promise<void>(resolve => {resolveTargets = resolve;});
  const worker = createEnrichmentProcessor({
    enabled: () => true, get: async () => ({...job}), update: async (_id, value) => {Object.assign(job, value);},
    targets: async () => {if(++targetReads === 1) await heldTargets; return target;},
    acquire: async () => currentOwner, release: async () => {}, enqueue: async () => {},
    claimSubmission: async (_id, owner) => {if(owner !== currentOwner || job.status !== 'queued') return false; job.status = 'submitting'; return true;},
    runPaid: (units, submit) => {reservations++; return withProviderBudget(f.db, 'enrichment', submit, units);},
    provider: async () => {paid++; return {payload: {requestId: 'provider-request'}};},
  });
  const first = worker('a'.repeat(64));
  while(!targetReads) await new Promise<void>(resolve => setImmediate(resolve));
  currentOwner = 'replacement'; await worker('a'.repeat(64));
  resolveTargets(); await first;
  assert.equal(paid, 1); assert.equal(reservations, 1); assert.equal(job.status, 'polling');
  assert.deepEqual(f.units(), [1, 1, 1, 1]);
});


test('global reservation delayed past the worker lease never starts a paid POST', async () => {
  const f = memoryBudgetDb(); let now = Date.now(); let paid = 0;
  const job = {uid: 'owner', founderIds: ['one'], companySlug: 'company', status: 'queued', createdAt: now, expiresAt: now + 900_000, userLease: 'user-token'} as EnrichmentJob;
  const worker = createEnrichmentProcessor({
    enabled: () => true, clock: () => now, get: async () => ({...job}), update: async (_id, value) => {Object.assign(job, value);},
    targets: async () => ({company: {} as Company, founders: [{name: 'One'} as Founder]}),
    acquire: async () => 'owner', release: async () => {}, enqueue: async () => {},
    claimSubmission: async () => {job.status = 'submitting'; return true;},
    runPaid: (units, submit) => {now += 90_001; return withProviderBudget(f.db, 'enrichment', submit, units, {clock: () => now});},
    provider: async () => {paid++; return {payload: {requestId: 'provider-request'}};},
  });
  await worker('a'.repeat(64));
  assert.equal(paid, 0); assert.equal(job.reason, 'PROVIDER_BUDGET_REJECTED');
  assert.equal(job.providerBudgetStatus, 503);
});

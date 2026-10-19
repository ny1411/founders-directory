import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createObservability,
  normalizeRoute,
  sanitizeLogFields,
  validateMetricTags,
  type MetricEmitter,
  type StructuredLog,
} from './observability';

test('normalizes raw URLs and dynamic paths into a bounded route vocabulary', () => {
  assert.equal(normalizeRoute('https://example.com/?email=private@example.com'), '/');
  assert.equal(normalizeRoute('/company/acme?token=secret'), '/company/[slug]');
  assert.equal(normalizeRoute('/company/acme/opengraph-image'), '/company/[slug]/opengraph-image');
  assert.equal(normalizeRoute('/api/enrich-contact/unique-job-id'), '/api/enrich-contact/[jobId]');
  assert.equal(normalizeRoute('/api/profile/'), '/api/profile');
  assert.equal(normalizeRoute('/unlisted/private/path'), '/other');
  assert.equal(normalizeRoute('http://%'), '/other');
});

test('emits only finite metric names, values, and dimensions', () => {
  const emitted: Parameters<MetricEmitter>[] = [];
  const telemetry = createObservability({emitMetric: (...args) => emitted.push(args)});

  telemetry.metric('directory.query.result_count', 12, {
    route: '/api/directory',
    outcome: 'success',
    environment: 'production',
  });

  assert.deepEqual(emitted, [[
    'directory.query.result_count',
    12,
    {route: '/api/directory', outcome: 'success', environment: 'production'},
  ]]);
  assert.equal(Object.isFrozen(emitted[0][2]), true);
  assert.throws(() => telemetry.metric('custom.dynamic' as never, 1), /bounded vocabulary/);
  assert.throws(() => telemetry.metric('directory.query.result_count', Number.NaN), /finite non-negative/);
  assert.throws(() => telemetry.metric('directory.query.result_count', -1), /finite non-negative/);
});

test('route instrumentation emits bounded duration, attempt, quota, and status telemetry', async () => {
  const { instrumentApiRoute } = await import('./observability-runtime');
  const handler = instrumentApiRoute(
    {
      route: '/api/generate-dm',
      event: 'dm_generation',
      durationMetric: 'dm_generation.duration_ms',
      attemptMetric: 'dm_generation.attempts',
      provider: 'gemini',
    },
    async () => new Response(null, {status: 429}),
  );
  const original = console.info;
  const logs: string[] = [];
  console.info = (...values: unknown[]) => logs.push(values.join(' '));
  try {
    assert.equal((await handler(new Request('http://localhost/api/generate-dm'), undefined)).status, 429);
  } finally {
    console.info = original;
  }
  assert.equal(logs.length, 1);
  const record = JSON.parse(logs[0]);
  assert.equal(record.route, '/api/generate-dm');
  assert.equal(record.outcome, 'rate_limited');
  assert.equal(record.status_code, 429);
  assert.equal('authorization' in record, false);
});

test('rejects sensitive, unique, unknown, and invalid metric tags at runtime', () => {
  for (const forbidden of [
    {user_id: 'user-1'},
    {request_id: 'request-1'},
    {correlation_id: 'correlation-1'},
    {email: 'private@example.com'},
    {ip_address: '192.0.2.1'},
    {authorization: 'Bearer token'},
    {raw_query: 'secret'},
    {company_name: 'Acme'},
  ]) {
    assert.throws(() => validateMetricTags(forbidden), /forbidden sensitive or high-cardinality/);
  }
  assert.throws(() => validateMetricTags({campaign: 'unique'}), /unsupported key/);
  assert.throws(() => validateMetricTags({route: '/company/acme'}), /bounded vocabulary/);
  assert.throws(() => validateMetricTags({outcome: 'error-123'}), /bounded vocabulary/);
  assert.throws(() => validateMetricTags([]), /plain object/);
});

test('structured logs contain diagnostic context without accepting private payloads', () => {
  const logs: StructuredLog[] = [];
  const telemetry = createObservability({
    writeLog: record => logs.push(record),
    clock: {isoNow: () => '2026-10-19T00:00:00.000Z'},
  });
  const record = telemetry.log('directory.query', 'correlation_id_123456', {
    route: '/api/directory',
    outcome: 'success',
    elapsed_ms: 14.5,
    cache_result: 'miss',
    candidate_count: 50,
    result_count: 10,
    provider: 'firestore',
  });

  assert.deepEqual(record, {
    event: 'directory.query',
    correlation_id: 'correlation_id_123456',
    timestamp: '2026-10-19T00:00:00.000Z',
    route: '/api/directory',
    outcome: 'success',
    elapsed_ms: 14.5,
    cache_result: 'miss',
    candidate_count: 50,
    result_count: 10,
    provider: 'firestore',
  });
  assert.equal(logs.length, 1);
  assert.equal(Object.isFrozen(record), true);
});

test('log sanitizer rejects secrets, private content, arbitrary strings, and bad numbers', () => {
  for (const forbidden of [
    {route: '/', outcome: 'success', token: 'secret'},
    {route: '/', outcome: 'success', resume_content: 'private'},
    {route: '/', outcome: 'success', generated_message: 'private'},
    {route: '/', outcome: 'success', contact_result: 'private'},
    {route: '/', outcome: 'success', request_id: 'unique'},
    {route: '/', outcome: 'success', query_string: 'email=private'},
  ]) {
    assert.throws(() => sanitizeLogFields(forbidden), /forbidden sensitive or high-cardinality/);
  }
  assert.throws(() => sanitizeLogFields({route: '/', outcome: 'success', note: 'arbitrary'}), /unsupported key/);
  assert.throws(() => sanitizeLogFields({route: '/', outcome: 'success', elapsed_ms: Infinity}), /finite non-negative/);
  assert.throws(() => sanitizeLogFields({route: '/', outcome: 'success', status_code: 99}), /100 through 599/);
  assert.throws(() => sanitizeLogFields({route: '/'}), /require route and outcome/);
});

test('correlation IDs are present in logs and impossible to add to metric tags', () => {
  const metrics: Parameters<MetricEmitter>[] = [];
  const logs: StructuredLog[] = [];
  const telemetry = createObservability({
    emitMetric: (...args) => metrics.push(args),
    writeLog: record => logs.push(record),
    correlationIdFactory: () => 'generated_correlation_123',
    clock: {now: (() => { let value = 100; return () => (value += 25); })()},
  });
  const timer = telemetry.startTimer({
    metric: 'company.load.duration_ms',
    event: 'company.load',
    route: '/company/[slug]',
    tags: {environment: 'preview'},
  });
  timer.finish({outcome: 'success', fields: {cache_result: 'hit'}});

  assert.equal(timer.correlationId, 'generated_correlation_123');
  assert.equal(logs[0].correlation_id, 'generated_correlation_123');
  assert.equal(logs[0].elapsed_ms, 25);
  assert.deepEqual(metrics[0], [
    'company.load.duration_ms',
    25,
    {route: '/company/[slug]', environment: 'preview', outcome: 'success'},
  ]);
  assert.equal('correlation_id' in (metrics[0][2] ?? {}), false);
  assert.throws(() => validateMetricTags({correlation_id: timer.correlationId}), /forbidden/);
});

test('timers merge bounded context, clamp clock skew, and can finish only once', () => {
  const metrics: Parameters<MetricEmitter>[] = [];
  const logs: StructuredLog[] = [];
  let tick = 20;
  const telemetry = createObservability({
    emitMetric: (...args) => metrics.push(args),
    writeLog: record => logs.push(record),
    clock: {now: () => (tick -= 5)},
  });
  const timer = telemetry.startTimer({
    metric: 'onboarding.save.duration_ms',
    event: 'onboarding.save',
    correlationId: 'fixed_correlation_123',
    route: '/api/onboarding',
    tags: {provider: 'firestore'},
    fields: {provider: 'firestore'},
  });
  timer.finish({
    outcome: 'error',
    tags: {quota_decision: 'allowed'},
    fields: {error_code: 'provider_error', provider_latency_ms: 7},
  });

  assert.equal(metrics[0][1], 0);
  assert.deepEqual(metrics[0][2], {
    route: '/api/onboarding',
    provider: 'firestore',
    quota_decision: 'allowed',
    outcome: 'error',
  });
  assert.equal(logs[0].error_code, 'provider_error');
  assert.equal(logs[0].provider_latency_ms, 7);
  assert.throws(() => timer.finish({outcome: 'success'}), /already finished/);
});

test('invalid timer context is rejected before starting operation timing', () => {
  const telemetry = createObservability();
  assert.throws(() => telemetry.startTimer({
    metric: 'company.load.duration_ms',
    event: 'company.load',
    correlationId: 'too-short',
    route: '/company/[slug]',
  }), /correlation ID/);
  assert.throws(() => telemetry.startTimer({
    metric: 'company.load.duration_ms',
    event: 'company.load',
    route: '/company/raw-slug' as never,
  }), /bounded vocabulary/);
  assert.throws(() => telemetry.startTimer({
    metric: 'company.load.duration_ms',
    event: 'company.load',
    route: '/company/[slug]',
    tags: {route: '/' } as never,
  }), /cannot override reserved context/);

  const timer = telemetry.startTimer({
    metric: 'company.load.duration_ms',
    event: 'company.load',
    route: '/company/[slug]',
  });
  assert.throws(() => timer.finish({
    outcome: 'success',
    fields: {elapsed_ms: 999} as never,
  }), /cannot override reserved context/);
});

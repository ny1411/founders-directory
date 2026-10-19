/**
 * Privacy-safe observability primitives.
 *
 * The finite vocabularies in this module are deliberate: adding a metric,
 * route, event, or dimension requires a code review instead of accepting
 * arbitrary request data at runtime.
 */

export const METRIC_NAMES = [
  'directory.query.duration_ms',
  'directory.query.result_count',
  'directory.query.candidate_count',
  'company.load.duration_ms',
  'contact_enrichment.attempts',
  'contact_enrichment.batch_size',
  'contact_enrichment.duration_ms',
  'dm_generation.attempts',
  'dm_generation.duration_ms',
  'resume_extraction.duration_ms',
  'api.quota_rejections',
  'onboarding.save.attempts',
  'onboarding.save.duration_ms',
] as const;

export const NORMALIZED_ROUTES = [
  '/',
  '/company/[slug]',
  '/company/[slug]/opengraph-image',
  '/api/directory',
  '/api/enrich-contact',
  '/api/enrich-contact/[jobId]',
  '/api/generate-dm',
  '/api/extract-resume',
  '/api/onboarding',
  '/api/profile',
  '/api/auth/sync',
  '/other',
] as const;

export const OUTCOMES = ['success', 'error', 'rejected', 'rate_limited', 'not_found', 'skipped'] as const;
export const CACHE_RESULTS = ['hit', 'miss', 'bypass', 'stale', 'none', 'unknown'] as const;
export const PROVIDERS = ['firestore', 'firebase_auth', 'gemini', 'saleshandy', 'vercel_queue', 'internal', 'none'] as const;
export const QUOTA_DECISIONS = ['allowed', 'rejected', 'not_applicable'] as const;
export const ENVIRONMENTS = ['production', 'preview', 'development', 'test', 'unknown'] as const;
export const LOG_EVENTS = [
  'directory.query',
  'company.load',
  'contact_enrichment',
  'dm_generation',
  'api.quota_rejection',
  'onboarding.save',
  'resume_extraction',
  'profile',
  'auth.sync',
] as const;
export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'quota_exceeded',
  'provider_error',
  'timeout',
  'internal_error',
  'unavailable',
] as const;

type Member<T extends readonly string[]> = T[number];
export type MetricName = Member<typeof METRIC_NAMES>;
export type NormalizedRoute = Member<typeof NORMALIZED_ROUTES>;
export type Outcome = Member<typeof OUTCOMES>;
export type CacheResult = Member<typeof CACHE_RESULTS>;
export type Provider = Member<typeof PROVIDERS>;
export type QuotaDecision = Member<typeof QUOTA_DECISIONS>;
export type Environment = Member<typeof ENVIRONMENTS>;
export type LogEvent = Member<typeof LOG_EVENTS>;
export type ErrorCode = Member<typeof ERROR_CODES>;

export type MetricTags = Partial<{
  route: NormalizedRoute;
  outcome: Outcome;
  cache_result: CacheResult;
  provider: Provider;
  quota_decision: QuotaDecision;
  environment: Environment;
}>;

export type MetricEmitter = (name: MetricName, value: number, tags?: Readonly<Record<string, string>>) => void;

export type LogFields = {
  route: NormalizedRoute;
  outcome: Outcome;
  elapsed_ms?: number;
  cache_result?: CacheResult;
  query_count?: number;
  result_count?: number;
  candidate_count?: number;
  batch_size?: number;
  quota_decision?: QuotaDecision;
  provider?: Provider;
  provider_latency_ms?: number;
  environment?: Environment;
  status_code?: number;
  error_code?: ErrorCode;
};

export type StructuredLog = Readonly<LogFields & {
  event: LogEvent;
  correlation_id: string;
  timestamp: string;
}>;

export type LogWriter = (record: StructuredLog) => void;

type Clock = {now: () => number; isoNow: () => string};

const METRIC_TAG_VALUES: Record<keyof MetricTags, readonly string[]> = {
  route: NORMALIZED_ROUTES,
  outcome: OUTCOMES,
  cache_result: CACHE_RESULTS,
  provider: PROVIDERS,
  quota_decision: QUOTA_DECISIONS,
  environment: ENVIRONMENTS,
};

const LOG_FIELD_VALUES: Partial<Record<keyof LogFields, readonly string[]>> = {
  route: NORMALIZED_ROUTES,
  outcome: OUTCOMES,
  cache_result: CACHE_RESULTS,
  quota_decision: QUOTA_DECISIONS,
  provider: PROVIDERS,
  environment: ENVIRONMENTS,
  error_code: ERROR_CODES,
};

const NUMERIC_LOG_FIELDS = new Set<keyof LogFields>([
  'elapsed_ms',
  'query_count',
  'result_count',
  'candidate_count',
  'batch_size',
  'provider_latency_ms',
  'status_code',
]);

// Checked before the allowlist so mistakes fail with an explicitly sensitive
// error. This pattern is only applied to field/tag names, never user values.
const SENSITIVE_OR_UNBOUNDED_KEY = /(?:^|_)(?:authorization|cookie|token|secret|password|email|ip|user|uid|request_id|correlation_id|query_string|raw_query|company|contact|resume|message|payload|body)(?:$|_)/i;
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertKnown(value: unknown, allowed: readonly string[], label: string): asserts value is string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new TypeError(`${label} must use the documented bounded vocabulary`);
  }
}

function assertFiniteNonNegative(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
}

function rejectSensitiveKey(key: string, context: string) {
  if (SENSITIVE_OR_UNBOUNDED_KEY.test(key)) {
    throw new TypeError(`${context} contains a forbidden sensitive or high-cardinality key`);
  }
}

function rejectReservedKeys(input: unknown, reserved: readonly string[], context: string) {
  if (input === undefined) return;
  if (!isPlainRecord(input)) throw new TypeError(`${context} must be a plain object`);
  if (Object.keys(input).some(key => reserved.includes(key))) {
    throw new TypeError(`${context} cannot override reserved context`);
  }
}

export function normalizeRoute(input: string | URL): NormalizedRoute {
  let pathname: string;
  try {
    pathname = input instanceof URL ? input.pathname : new URL(input, 'https://observability.invalid').pathname;
  } catch {
    return '/other';
  }

  if (pathname === '/') return '/';
  if (/^\/company\/[^/]+\/opengraph-image\/?$/.test(pathname)) return '/company/[slug]/opengraph-image';
  if (/^\/company\/[^/]+\/?$/.test(pathname)) return '/company/[slug]';
  if (/^\/api\/enrich-contact\/[^/]+\/?$/.test(pathname)) return '/api/enrich-contact/[jobId]';

  const withoutTrailingSlash = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const exact = NORMALIZED_ROUTES.find(route => route === withoutTrailingSlash);
  return exact ?? '/other';
}

export function createCorrelationId(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return randomUUID();
  // Older test runtimes may not expose Web Crypto. This value is diagnostic,
  // carries no identity, and is never accepted as a metric dimension.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`.slice(0, 64);
}

export function validateMetricTags(input: unknown): Readonly<Record<string, string>> {
  if (!isPlainRecord(input)) throw new TypeError('metric tags must be a plain object');
  const output: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    rejectSensitiveKey(key, 'metric tags');
    if (!(key in METRIC_TAG_VALUES)) throw new TypeError('metric tags contain an unsupported key');
    const typedKey = key as keyof MetricTags;
    assertKnown(value, METRIC_TAG_VALUES[typedKey], `metric tag ${key}`);
    output[key] = value;
  }

  return Object.freeze(output);
}

export function sanitizeLogFields(input: unknown): Readonly<LogFields> {
  if (!isPlainRecord(input)) throw new TypeError('log fields must be a plain object');
  const output: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(input)) {
    rejectSensitiveKey(key, 'log fields');
    if (!(key in LOG_FIELD_VALUES) && !NUMERIC_LOG_FIELDS.has(key as keyof LogFields)) {
      throw new TypeError('log fields contain an unsupported key');
    }

    const typedKey = key as keyof LogFields;
    if (NUMERIC_LOG_FIELDS.has(typedKey)) {
      assertFiniteNonNegative(value, `log field ${key}`);
      if (typedKey === 'status_code' && (!Number.isInteger(value) || value < 100 || value > 599)) {
        throw new TypeError('status_code must be an integer from 100 through 599');
      }
      output[key] = value;
      continue;
    }

    assertKnown(value, LOG_FIELD_VALUES[typedKey] ?? [], `log field ${key}`);
    output[key] = value;
  }

  if (!('route' in output) || !('outcome' in output)) {
    throw new TypeError('log fields require route and outcome');
  }
  return Object.freeze(output) as Readonly<LogFields>;
}

export type ObservabilityOptions = {
  emitMetric?: MetricEmitter;
  writeLog?: LogWriter;
  clock?: Partial<Clock>;
  correlationIdFactory?: () => string;
};

export type TimerStart = {
  metric: MetricName;
  event: LogEvent;
  correlationId?: string;
  route: NormalizedRoute;
  tags?: Omit<MetricTags, 'route' | 'outcome'>;
  fields?: Omit<LogFields, 'route' | 'outcome' | 'elapsed_ms'>;
};

export type TimerFinish = {
  outcome: Outcome;
  tags?: Omit<MetricTags, 'route' | 'outcome'>;
  fields?: Omit<LogFields, 'route' | 'outcome' | 'elapsed_ms'>;
};

export function createObservability(options: ObservabilityOptions = {}) {
  const emitMetric = options.emitMetric ?? (() => {});
  const writeLog = options.writeLog ?? ((record: StructuredLog) => console.info(JSON.stringify(record)));
  const now = options.clock?.now ?? (() => performance.now());
  const isoNow = options.clock?.isoNow ?? (() => new Date().toISOString());
  const correlationIdFactory = options.correlationIdFactory ?? createCorrelationId;

  function metric(name: MetricName, value: number, tags: MetricTags = {}) {
    assertKnown(name, METRIC_NAMES, 'metric name');
    assertFiniteNonNegative(value, 'metric value');
    emitMetric(name, value, validateMetricTags(tags));
  }

  function log(event: LogEvent, correlationId: string, fields: LogFields): StructuredLog {
    assertKnown(event, LOG_EVENTS, 'log event');
    if (!CORRELATION_ID.test(correlationId)) throw new TypeError('correlation ID has an invalid format');
    const safeFields = sanitizeLogFields(fields);
    const record = Object.freeze({
      event,
      correlation_id: correlationId,
      timestamp: isoNow(),
      ...safeFields,
    }) as StructuredLog;
    writeLog(record);
    return record;
  }

  function startTimer(start: TimerStart) {
    assertKnown(start.metric, METRIC_NAMES, 'metric name');
    assertKnown(start.event, LOG_EVENTS, 'log event');
    assertKnown(start.route, NORMALIZED_ROUTES, 'route');
    const correlationId = start.correlationId ?? correlationIdFactory();
    if (!CORRELATION_ID.test(correlationId)) throw new TypeError('correlation ID has an invalid format');
    // Validate before work starts so programming errors fail at the call site.
    rejectReservedKeys(start.tags, ['route', 'outcome'], 'timer tags');
    rejectReservedKeys(start.fields, ['route', 'outcome', 'elapsed_ms'], 'timer fields');
    validateMetricTags({route: start.route, ...start.tags});
    if (start.fields) sanitizeLogFields({route: start.route, outcome: 'success', ...start.fields});
    const startedAt = now();
    let finished = false;

    return {
      correlationId,
      finish(result: TimerFinish) {
        if (finished) throw new Error('observability timer already finished');
        assertKnown(result.outcome, OUTCOMES, 'outcome');
        rejectReservedKeys(result.tags, ['route', 'outcome'], 'timer tags');
        rejectReservedKeys(result.fields, ['route', 'outcome', 'elapsed_ms'], 'timer fields');
        finished = true;
        const elapsed = Math.max(0, now() - startedAt);
        metric(start.metric, elapsed, {route: start.route, ...start.tags, ...result.tags, outcome: result.outcome});
        return log(start.event, correlationId, {
          route: start.route,
          ...start.fields,
          ...result.fields,
          elapsed_ms: elapsed,
          outcome: result.outcome,
        });
      },
    };
  }

  return {metric, log, startTimer};
}

import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NORMALIZED_ROUTES } from '../../src/lib/observability.ts';
import { rolloutTarget } from '../security/rollout-readiness.mjs';

const HOUR = 3_600_000;
const MAX_BYTES = 64 * 1024;
const publicRoutes = ['/', '/api/directory', '/company/[slug]'];
export const thresholds = Object.freeze({ growth: 5, minimumRequests: 100, errorRate: 0.05, minimumErrors: 5, cacheHitRate: 0.8, concentration: 0.8, pageviewsPerVisitor: 20, clientHomepageRequests: 60 });
const invalid = () => { throw new Error('Invalid usage snapshot; verify schema, project, window, freshness and aggregate counts.'); };
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid();
}
function count(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000) invalid();
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) invalid();
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) invalid();
  return result;
}
function counts(value, keys) {
  object(value, keys);
  for (const key of keys) count(value[key]);
}

/** Accept only explicitly scoped hourly aggregates. Never ingest or return raw logs. */
export function assessUsageSnapshot(snapshot, now = Date.now()) {
  object(snapshot, ['schemaVersion', 'projectId', 'teamId', 'environment', 'capturedAt', 'windowStart', 'windowEnd', 'current', 'baseline', 'cpu', 'publicCache', 'analytics', 'firewall', 'largestClientHomepageRequestsTenMinutes', 'topRoute']);
  if (snapshot.schemaVersion !== 1 || snapshot.projectId !== rolloutTarget.projectId || snapshot.teamId !== rolloutTarget.teamId || !['production', 'preview'].includes(snapshot.environment) || !Number.isFinite(now)) invalid();
  const captured = timestamp(snapshot.capturedAt), start = timestamp(snapshot.windowStart), end = timestamp(snapshot.windowEnd);
  // A closed hour, captured promptly and assessed within 15 minutes. Stale data is not a live all-clear.
  if (end - start !== HOUR || captured < end || captured > now + 60_000 || now - captured > 900_000 || now - end > 900_000 || end > now + 60_000) invalid();
  counts(snapshot.current, ['requests', 'functionInvocations', 'functionErrors', 'homepageRequests']);
  const current = snapshot.current;
  if (current.functionErrors > current.functionInvocations || current.homepageRequests > current.requests) invalid();
  const missing = [];
  const findings = [];
  const add = (signal, severity, action, route) => findings.push({signal, severity, action, ...(route ? {route} : {})});
  let elevated = false;
  if (snapshot.baseline == null) missing.push('baseline');
  else {
    object(snapshot.baseline, ['windowStart', 'windowEnd', 'requests', 'functionInvocations', 'homepageRequests']);
    const baseStart = timestamp(snapshot.baseline.windowStart), baseEnd = timestamp(snapshot.baseline.windowEnd);
    if (baseEnd - baseStart !== HOUR || baseEnd > start || start - baseStart > 28 * 24 * HOUR || (start - baseStart) % (24 * HOUR) !== 0) invalid();
    for (const key of ['requests', 'functionInvocations', 'homepageRequests']) count(snapshot.baseline[key]);
    if (snapshot.baseline.homepageRequests > snapshot.baseline.requests) invalid();
    for (const [key, signal] of [['requests', 'request_growth'], ['functionInvocations', 'function_growth'], ['homepageRequests', 'homepage_growth']]) {
      if (current[key] >= thresholds.minimumRequests && current[key] > thresholds.growth * snapshot.baseline[key]) {
        elevated = true;
        add(signal, 'warning', key === 'functionInvocations' ? 'inspect_function_routes_cpu_and_deployment' : 'compare_firewall_functions_and_cache', key === 'homepageRequests' ? '/' : undefined);
      }
    }
  }
  if (current.functionInvocations >= thresholds.minimumRequests && current.functionErrors >= thresholds.minimumErrors && current.functionErrors / current.functionInvocations >= thresholds.errorRate) {
    add('function_errors', 'warning', 'inspect_normalized_routes_and_stable_error_codes');
  }
  if (snapshot.cpu == null) missing.push('cpu');
  else {
    object(snapshot.cpu, ['usedMilliseconds', 'allowanceMilliseconds', 'periodStart', 'periodEnd', 'scope']);
    if (!['team_all_environments', 'project_all_environments'].includes(snapshot.cpu.scope)) invalid();
    count(snapshot.cpu.usedMilliseconds); count(snapshot.cpu.allowanceMilliseconds);
    const periodStart = timestamp(snapshot.cpu.periodStart), periodEnd = timestamp(snapshot.cpu.periodEnd);
    if (!snapshot.cpu.allowanceMilliseconds || periodStart > start || periodEnd <= captured || periodEnd - periodStart > 32 * 24 * HOUR) invalid();
    const ratio = snapshot.cpu.usedMilliseconds / snapshot.cpu.allowanceMilliseconds;
    if (ratio >= 0.9) add('cpu_90', 'critical', 'contain_responsible_route_or_feature_immediately');
    else if (ratio >= 0.75) add('cpu_75', 'warning', 'assign_incident_owner_and_prepare_containment');
    else if (ratio >= 0.5) add('cpu_50', 'warning', 'inspect_cpu_trend_functions_and_cache_misses');
  }
  if (snapshot.publicCache == null) missing.push('public_cache');
  else {
    if (!Array.isArray(snapshot.publicCache) || snapshot.publicCache.length > publicRoutes.length) invalid();
    const seen = new Set();
    let requests = 0;
    for (const row of snapshot.publicCache) {
      object(row, ['route', 'requests', 'hits']);
      if (!publicRoutes.includes(row.route) || seen.has(row.route)) invalid();
      seen.add(row.route); count(row.requests); count(row.hits); requests += row.requests;
      if (row.hits > row.requests) invalid();
      if (row.requests >= thresholds.minimumRequests && row.hits / row.requests < thresholds.cacheHitRate) add('public_cache_hit_rate', 'warning', 'inspect_miss_bypass_isr_and_recent_deployment', row.route);
    }
    if (requests > current.requests) invalid();
    if (seen.size < publicRoutes.length) missing.push('public_cache_routes');
  }
  if (snapshot.analytics == null) missing.push('analytics');
  else {
    counts(snapshot.analytics, ['pageviews', 'visitors', 'topCohortPageviews']);
    const {pageviews, visitors, topCohortPageviews} = snapshot.analytics;
    if (visitors > pageviews || topCohortPageviews > pageviews) invalid();
    if (pageviews >= thresholds.minimumRequests && (!visitors || pageviews / visitors > thresholds.pageviewsPerVisitor)) add('pageview_visitor_ratio', 'warning', 'compare_analytics_cohort_with_firewall_and_functions');
    if (elevated && pageviews >= thresholds.minimumRequests && topCohortPageviews / pageviews > thresholds.concentration) add('cohort_concentration', 'warning', 'inspect_cohort_evidence_without_broad_blocking');
  }
  if (snapshot.firewall == null) missing.push('firewall');
  else {
    counts(snapshot.firewall, ['requests', 'mitigated']);
    if (snapshot.firewall.mitigated > snapshot.firewall.requests || snapshot.firewall.requests > current.requests) invalid();
    if (snapshot.firewall.requests >= thresholds.minimumRequests && snapshot.firewall.mitigated / snapshot.firewall.requests > thresholds.concentration) add('firewall_mitigations', 'warning', 'check_legitimate_users_and_compare_function_invocations');
  }
  const client = snapshot.largestClientHomepageRequestsTenMinutes;
  if (client == null) missing.push('client_homepage_rate');
  else {
    count(client);
    if (client > current.homepageRequests) invalid();
    if (client > thresholds.clientHomepageRequests) add('client_homepage_rate', 'warning', 'inspect_narrow_root_rule_and_verified_crawlers', '/');
  }
  if (snapshot.topRoute == null) missing.push('top_route');
  else {
    object(snapshot.topRoute, ['route', 'requests']);
    if (!NORMALIZED_ROUTES.includes(snapshot.topRoute.route)) invalid();
    count(snapshot.topRoute.requests);
    if (snapshot.topRoute.requests > current.requests) invalid();
    if (elevated && current.requests >= thresholds.minimumRequests && snapshot.topRoute.requests / current.requests > thresholds.concentration) add('route_concentration', 'warning', 'inspect_route_cache_and_function_work', snapshot.topRoute.route);
  }
  return {
    schemaVersion: 1, projectId: rolloutTarget.projectId, teamId: rolloutTarget.teamId,
    environment: snapshot.environment, windowStart: new Date(start).toISOString(), windowEnd: new Date(end).toISOString(),
    assessment: findings.length ? 'needs_attention' : missing.length ? 'incomplete' : 'no_threshold_crossed',
    severity: findings.some(item => item.severity === 'critical') ? 'critical' : findings.length ? 'warning' : 'none',
    findings, unavailableSignals: missing, cpuScope: snapshot.cpu?.scope ?? 'unavailable',
    continuousMonitoring: false, notificationDeliveryVerified: false,
  };
}

export function readUsageSnapshot(path) {
  // Nonblocking open allows rejecting FIFOs before a writer arrives. Only regular files are accepted.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  const bytes = Buffer.alloc(MAX_BYTES + 1);
  let length = 0;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) invalid();
    for (;;) {
      const read = readSync(fd, bytes, length, bytes.length - length, null);
      length += read;
      if (length > MAX_BYTES) invalid();
      if (!read) break;
    }
  } finally { closeSync(fd); }
  try { return JSON.parse(bytes.subarray(0, length).toString('utf8')); }
  catch { invalid(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) invalid();
    const result = assessUsageSnapshot(readUsageSnapshot(process.argv[2]));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.assessment === 'needs_attention' ? 1 : result.assessment === 'incomplete' ? 3 : 0;
  } catch {
    console.error('Usage evaluation failed. Verify a fresh, scoped hourly aggregate snapshot; input and file paths are not echoed.');
    process.exitCode = 2;
  }
}

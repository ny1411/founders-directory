import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { assessUsageSnapshot, readUsageSnapshot } from './usage-anomaly.mjs';
import { rolloutTarget } from '../security/rollout-readiness.mjs';

const now = Date.parse('2026-10-26T05:05:00Z');
function fixture() {
  return {
    schemaVersion: 1, projectId: rolloutTarget.projectId, teamId: rolloutTarget.teamId, environment: 'production',
    capturedAt: '2026-10-26T05:01:00Z', windowStart: '2026-10-26T04:00:00Z', windowEnd: '2026-10-26T05:00:00Z',
    current: {requests: 1000, functionInvocations: 100, functionErrors: 0, homepageRequests: 500},
    baseline: {windowStart: '2026-10-25T04:00:00Z', windowEnd: '2026-10-25T05:00:00Z', requests: 1000, functionInvocations: 100, homepageRequests: 500},
    cpu: {scope: 'team_all_environments', usedMilliseconds: 100, allowanceMilliseconds: 1000, periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z'},
    publicCache: [{route: '/', requests: 500, hits: 450}, {route: '/company/[slug]', requests: 200, hits: 180}, {route: '/api/directory', requests: 100, hits: 90}],
    analytics: {pageviews: 1000, visitors: 200, topCohortPageviews: 300},
    firewall: {requests: 1000, mitigated: 0}, largestClientHomepageRequestsTenMinutes: 20,
    topRoute: {route: '/', requests: 500},
  };
}
const assess = value => assessUsageSnapshot(value, now);

test('complete quiet snapshot yields only a scoped no-threshold result, never notification or monitoring proof', () => {
  const report = assess(fixture());
  assert.equal(report.assessment, 'no_threshold_crossed');
  assert.equal(report.severity, 'none');
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.unavailableSignals, []);
  assert.equal(report.continuousMonitoring, false);
  assert.equal(report.notificationDeliveryVerified, false);
});

test('incident cohort triggers actionable growth, CPU, route, analytics, cache and error diagnostics', () => {
  const snapshot = fixture();
  snapshot.current = {requests: 6000, functionInvocations: 600, functionErrors: 30, homepageRequests: 5500};
  snapshot.cpu.usedMilliseconds = 900;
  snapshot.publicCache[0] = {route: '/', requests: 5500, hits: 400};
  snapshot.analytics = {pageviews: 6000, visitors: 18, topCohortPageviews: 5900};
  snapshot.topRoute = {route: '/', requests: 5500};
  snapshot.largestClientHomepageRequestsTenMinutes = 61;
  const report = assess(snapshot);
  assert.equal(report.assessment, 'needs_attention');
  assert.equal(report.severity, 'critical');
  assert.deepEqual(report.findings.map(item => item.signal).sort(), ['request_growth', 'function_growth', 'homepage_growth', 'cpu_90', 'function_errors', 'public_cache_hit_rate', 'pageview_visitor_ratio', 'cohort_concentration', 'route_concentration', 'client_homepage_rate'].sort());
  assert.ok(report.findings.every(item => typeof item.action === 'string'));
});

test('CPU boundary selects exactly one highest applicable warning without repeating lower tiers', () => {
  for (const [used, signal] of [[499, null], [500, 'cpu_50'], [750, 'cpu_75'], [900, 'cpu_90'], [1100, 'cpu_90']]) {
    const snapshot = fixture(); snapshot.cpu.usedMilliseconds = used;
    assert.deepEqual(assess(snapshot).findings.map(item => item.signal), signal ? [signal] : []);
  }
});

test('growth comparisons use strict 5x thresholds, traffic floors and meaningful zero baselines', () => {
  const snapshot = fixture();
  snapshot.baseline.requests = 200; snapshot.baseline.homepageRequests = 100;
  assert.ok(!assess(snapshot).findings.some(item => item.signal === 'request_growth'), 'exactly 5x is not above 5x');
  snapshot.current.requests = 1001;
  assert.ok(assess(snapshot).findings.some(item => item.signal === 'request_growth'));
  snapshot.baseline.functionInvocations = 0;
  snapshot.current.functionInvocations = 99;
  assert.ok(!assess(snapshot).findings.some(item => item.signal === 'function_growth'), 'tiny counts do not page on zero baselines');
  snapshot.current.functionInvocations = 100;
  assert.ok(assess(snapshot).findings.some(item => item.signal === 'function_growth'));
  snapshot.current.functionInvocations = 0;
  assert.ok(!assess(snapshot).findings.some(item => item.signal === 'function_growth'), 'zero over zero is quiet');
});

test('missing evidence is explicitly incomplete rather than healthy; partial cache coverage remains visible', () => {
  for (const key of ['baseline', 'cpu', 'publicCache', 'analytics', 'firewall', 'largestClientHomepageRequestsTenMinutes', 'topRoute']) {
    const snapshot = fixture(); delete snapshot[key];
    const report = assess(snapshot);
    assert.equal(report.assessment, 'incomplete', key);
    assert.equal(report.unavailableSignals.length, 1, key);
  }
  const snapshot = fixture(); snapshot.publicCache = [];
  assert.deepEqual(assess(snapshot).unavailableSignals, ['public_cache_routes']);
  snapshot.cpu = null; snapshot.baseline = null; snapshot.current.functionErrors = 10;
  const report = assess(snapshot);
  assert.equal(report.assessment, 'needs_attention');
  assert.ok(report.unavailableSignals.includes('cpu'), 'findings do not hide missing CPU evidence');
});

test('cache, concentration, and mitigation findings use observed volumes rather than noisy tiny samples', () => {
  const snapshot = fixture();
  snapshot.publicCache[0] = {route: '/', requests: 99, hits: 0};
  snapshot.analytics = {pageviews: 99, visitors: 1, topCohortPageviews: 99};
  snapshot.firewall = {requests: 99, mitigated: 99};
  assert.deepEqual(assess(snapshot).findings, []);
  snapshot.firewall = {requests: 100, mitigated: 81};
  assert.deepEqual(assess(snapshot).findings.map(item => item.signal), ['firewall_mitigations']);
});

test('wrong scope, stale/future data, mixed windows, malformed numbers and private dimensions fail closed', () => {
  const mutations = [
    value => { value.projectId = 'wrong'; }, value => { value.teamId = 'wrong'; }, value => { value.environment = 'prod'; },
    value => { value.windowEnd = '2026-10-26T04:59:00Z'; }, value => { value.capturedAt = '2026-10-26T03:00:00Z'; },
    value => { value.windowStart = '2026-10-26T05:00:00Z'; value.windowEnd = '2026-10-26T06:00:00Z'; value.capturedAt = '2026-10-26T06:00:00Z'; },
    value => { value.baseline.windowStart = '2026-10-25T03:00:00Z'; },
    value => { value.baseline.windowStart = '2026-10-25T03:00:00Z'; value.baseline.windowEnd = '2026-10-25T04:00:00Z'; },
    value => { value.baseline.windowStart = '2026-08-25T04:00:00Z'; value.baseline.windowEnd = '2026-08-25T05:00:00Z'; },
    value => { value.current.functionErrors = 101; }, value => { value.current.requests = -1; },
    value => { value.current.requests = NaN; }, value => { value.current.homepageRequests = 1001; },
    value => { delete value.current.functionInvocations; }, value => { value.cpu.allowanceMilliseconds = 0; },
    value => { value.cpu.scope = 'preview'; },
    value => { value.cpu.periodEnd = '2026-10-25T00:00:00Z'; },
    value => { value.publicCache[0].hits = 501; }, value => { value.publicCache.push(value.publicCache[0]); },
    value => { value.analytics.visitors = 1001; }, value => { value.firewall.mitigated = 1001; },
    value => { value.topRoute.route = '/company/private-slug?token=SECRET'; },
    value => { value.largestClientHomepageRequestsTenMinutes = 501; },
    value => { value.rawLogs = 'PRIVATE-TOKEN'; }, value => { value.analytics.userAgent = 'PRIVATE-AGENT'; },
  ];
  for (const mutate of mutations) {
    const snapshot = fixture(); mutate(snapshot);
    assert.throws(() => assess(snapshot), error => !/PRIVATE|SECRET/.test(error.message));
  }
});

test('CLI exits distinguish findings, incomplete, invalid and complete snapshots without echoing inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-anomaly-'));
  const file = join(directory, 'PRIVATE-FILE.json');
  const run = snapshot => {
    writeFileSync(file, JSON.stringify(snapshot));
    return spawnSync(process.execPath, [resolve('scripts/monitoring/usage-anomaly.mjs'), file], {encoding: 'utf8'});
  };
  const fresh = fixture();
  fresh.windowEnd = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  fresh.windowStart = new Date(Date.parse(fresh.windowEnd) - 3_600_000).toISOString();
  fresh.capturedAt = fresh.windowEnd;
  fresh.baseline = null; fresh.cpu = null;
  try {
    assert.equal(run(fresh).status, 3);
    fresh.baseline = {
      windowStart: new Date(Date.parse(fresh.windowStart) - 86_400_000).toISOString(),
      windowEnd: new Date(Date.parse(fresh.windowEnd) - 86_400_000).toISOString(),
      requests: 1000, functionInvocations: 100, homepageRequests: 500,
    };
    const clock = new Date();
    fresh.cpu = {scope: 'team_all_environments', usedMilliseconds: 0, allowanceMilliseconds: 1000,
      periodStart: new Date(Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), 1) - 3_600_000).toISOString(),
      periodEnd: new Date(Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth() + 1, 1)).toISOString(),
    };
    assert.equal(run(fresh).status, 0);
    fresh.current.functionErrors = 10;
    assert.equal(run(fresh).status, 1);
    fresh.rawLogs = 'PRIVATE-TOKEN';
    const bad = run(fresh);
    assert.equal(bad.status, 2);
    assert.doesNotMatch(bad.stderr + bad.stdout, /PRIVATE/);
    assert.throws(() => readUsageSnapshot(directory), /Invalid usage snapshot/);
    if (process.platform !== 'win32') {
      assert.throws(() => readUsageSnapshot('/dev/zero'), /Invalid usage snapshot/);
      const fifo = join(directory, 'snapshot-pipe');
      const created = spawnSync('mkfifo', [fifo]);
      assert.equal(created.status, 0);
      assert.throws(() => readUsageSnapshot(fifo), /Invalid usage snapshot/);
    }
    writeFileSync(file, 'PRIVATE-TOKEN');
    assert.throws(() => readUsageSnapshot(file), /Invalid usage snapshot/);
    writeFileSync(file, 'x'.repeat(65_537));
    assert.throws(() => readUsageSnapshot(file), /Invalid usage snapshot/);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

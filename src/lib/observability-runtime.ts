import {
  createObservability,
  type LogEvent,
  type MetricName,
  type NormalizedRoute,
  type Outcome,
  type Provider,
} from './observability';

// Custom Metrics need @vercel/functions plus project/plan support. Until the
// Vercel project is visible again, this runtime emits the same bounded data as
// structured logs; callers may inject metric() after entitlement is confirmed.
const observability = createObservability();

type RouteConfig = {
  route: NormalizedRoute;
  event: LogEvent;
  durationMetric: MetricName;
  attemptMetric?: MetricName;
  provider?: Provider;
};

function responseOutcome(status: number): Outcome {
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'error';
  if (status >= 400) return 'rejected';
  return 'success';
}
export function instrumentApiRoute<Context>(
  config: RouteConfig,
  handler: (request: Request, context: Context) => Promise<Response>,
) {
  return async (request: Request, context: Context): Promise<Response> => {
    const timer = observability.startTimer({
      metric: config.durationMetric,
      event: config.event,
      route: config.route,
      tags: config.provider ? {provider: config.provider} : undefined,
      fields: config.provider ? {provider: config.provider} : undefined,
    });
    try {
      const response = await handler(request, context);
      const outcome = responseOutcome(response.status);
      if (config.attemptMetric) {
        observability.metric(config.attemptMetric, 1, {
          route: config.route,
          outcome,
          ...(config.provider ? {provider: config.provider} : {}),
        });
      }
      if (response.status === 429) {
        observability.metric('api.quota_rejections', 1, {
          route: config.route,
          outcome: 'rate_limited',
          quota_decision: 'rejected',
        });
      }
      timer.finish({outcome, fields: {status_code: response.status}});
      return response;
    } catch (error) {
      timer.finish({outcome: 'error', fields: {error_code: 'internal_error'}});
      throw error;
    }
  };
}

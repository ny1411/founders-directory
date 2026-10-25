import {
  createObservability,
  type LogEvent,
  type MetricName,
  type NormalizedRoute,
  type Outcome,
  type Provider,
} from './observability';

// Custom Metrics need @vercel/functions plus project/plan support. The default
// transport preserves validated measurements in structured metric logs; an
// entitled project may inject metric() instead after deployed verification.
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
      // These routes carry identity/private data even on errors and quota/bot denials.
      if (config.route.startsWith('/api/') && config.route !== '/api/directory') {
        response.headers.set('Cache-Control', 'private, no-store');
      }
      return response;
    } catch (error) {
      timer.finish({outcome: 'error', fields: {error_code: 'internal_error'}});
      throw error;
    }
  };
}

/** Factory handlers also retain the privacy contract outside framework route wiring. */
export function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export function instrumentPrivateHandler(config: RouteConfig, handler: (request: Request) => Promise<Response>) {
  const wrapped = instrumentApiRoute(config, handler);
  return (request: Request) => wrapped(request, undefined);
}

/** Redirects are Next control flow, and are successful only with the known redirect digest. */
export async function instrumentCompanySubmission<T extends { error?: string; code?: string }>(handler: () => Promise<T>): Promise<T> {
  const timer = observability.startTimer({metric: 'company.submit.duration_ms', event: 'company.submit', route: '/company/new'});
  try {
    const result = await handler();
    const outcome: Outcome = result.code === 'RATE_LIMITED' ? 'rate_limited' : (result.code === 'LIMIT_UNAVAILABLE' || result.code === 'SAVE_FAILED') ? 'error' : result.error ? 'rejected' : 'success';
    timer.finish({outcome});
    return result;
  } catch (error) {
    const redirect = error !== null && typeof error === 'object' && 'digest' in error && typeof error.digest === 'string' && /^NEXT_REDIRECT;/.test(error.digest);
    timer.finish({outcome: redirect ? 'success' : 'error'});
    throw error;
  }
}

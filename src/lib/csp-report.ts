import { boundedJson } from './bounded-json';

const directives = new Set(['default-src', 'base-uri', 'object-src', 'frame-ancestors', 'form-action', 'script-src', 'script-src-elem', 'script-src-attr', 'style-src', 'style-src-elem', 'style-src-attr', 'font-src', 'img-src', 'connect-src', 'frame-src', 'worker-src']);

/** Browsers send full URLs and sometimes script samples. Retain neither. */
export async function receiveCspReport(request: Request, write = (directive: string) => {
  console.info(JSON.stringify({event: 'security.csp_report', directive}));
}) {
  const headers = {'Cache-Control': 'private, no-store'};
  if (!/^application\/(?:csp-report|reports\+json|json)(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    return new Response(null, {status: 415, headers});
  }
  try {
    const data = await boundedJson(request, 16_384);
    const reports = Array.isArray(data) ? data.slice(0, 5) : [data];
    const found = new Set<string>();
    for (const report of reports) {
      if (!report || typeof report !== 'object') continue;
      const body = report['csp-report'] ?? report.body;
      if (!body || typeof body !== 'object') continue;
      const directive = body['effective-directive'] ?? body.effectiveDirective;
      if (typeof directive === 'string') found.add(directives.has(directive) ? directive : 'other');
    }
    // At most one event per bounded directive per request, never the supplied report.
    for (const directive of found) write(directive);
    return new Response(null, {status: 204, headers});
  } catch (error) {
    return new Response(null, {status: error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400, headers});
  }
}

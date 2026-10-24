import { boundedJson } from './bounded-json';

interface Dependencies {
  verify(token: string): Promise<{uid: string}>;
  quota(uid: string, request: Request): Promise<{allowed: boolean; retryAfterSeconds: number}>;
  lookup(founderId: string, companySlug: string): Promise<{email: string | null} | null>;
}

const json = (body: unknown, status = 200, headers = {}) => Response.json(body, {status, headers: {'Cache-Control': 'private, no-store', ...headers}});

/** Returns existing contacts only. Authorization/quota precede every business read. */
export function createFounderContactHandler(deps: Dependencies) {
  return async (request: Request) => {
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
    if (!token) return json({error: 'Unauthorized'}, 401);
    let uid: string;
    try { uid = (await deps.verify(token)).uid; } catch { return json({error: 'Unauthorized'}, 401); }
    if (!uid) return json({error: 'Unauthorized'}, 401);
    try {
      const quota = await deps.quota(uid, request);
      if (!quota.allowed) return json({error: 'Too many contact requests'}, 429, {'Retry-After': String(quota.retryAfterSeconds)});
      let input: unknown;
      try { input = await boundedJson(request); } catch { return json({error: 'Invalid request'}, 400); }
      if (!input || typeof input !== 'object' || !('founderId' in input) || !('companySlug' in input) ||
          typeof input.founderId !== 'string' || !/^[\w-]{1,150}$/.test(input.founderId) ||
          typeof input.companySlug !== 'string' || !/^[a-z0-9-]{1,200}$/.test(input.companySlug)) return json({error: 'Invalid target'}, 400);
      const contact = await deps.lookup(input.founderId, input.companySlug);
      return contact ? json(contact) : json({error: 'Founder or company not found'}, 404);
    } catch { return json({error: 'Contact lookup temporarily unavailable'}, 503); }
  };
}

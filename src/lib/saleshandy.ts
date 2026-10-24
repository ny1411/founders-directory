export const MAX_SALESHANDY_RESPONSE_BYTES = 256 * 1024;
export const SALESHANDY_TIMEOUT_MS = 10_000;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Accept only bounded fields used by the enrichment worker. */
export function parseSaleshandyResponse(value: unknown) {
  const invalid = (): never => { throw new Error('INVALID_PROVIDER_RESPONSE'); };
  if (!record(value) || !record(value.payload)) return invalid();
  const payload = value.payload;
  const text = (value: unknown, limit: number): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string' || value.length > limit) return invalid();
    return value;
  };
  const requestId = text(payload.requestId, 200);
  if (requestId !== undefined && !/^[\w-]{1,200}$/.test(requestId)) return invalid();
  const status = text(payload.status, 100);
  let results: Array<Record<string, unknown>> | undefined;
  if (payload.results !== undefined) {
    if (!Array.isArray(payload.results) || payload.results.length > 100) return invalid();
    results = payload.results.map((row: unknown) => {
      if (!record(row)) return invalid();
      const result: Record<string, unknown> = {};
      for (const field of ['linkedin_url', 'first_name', 'last_name', 'email']) {
        const value = text(row[field], field === 'email' ? 320 : 2048);
        if (value !== undefined) result[field] = value;
      }
      if (row.emails !== undefined) {
        if (!Array.isArray(row.emails) || row.emails.length > 20) return invalid();
        result.emails = row.emails.map((email: unknown) => {
          if (!record(email)) return invalid();
          return { email: text(email.email, 320), verificationStatus: text(email.verificationStatus, 100) };
        });
      }
      return result;
    });
  }
  if (['completed', 'completed-with-errors'].includes(status ?? '') && !results) return invalid();
  return { payload: { requestId, status, results } };
}

async function beforeAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => {});
    throw new Error('PROVIDER_TIMEOUT');
  }
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('PROVIDER_TIMEOUT'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

export async function readSaleshandyResponse(response: Response, signal: AbortSignal) {
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error('PROVIDER_ERROR');
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_SALESHANDY_RESPONSE_BYTES)) {
    void response.body?.cancel().catch(() => {});
    throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw new Error('INVALID_PROVIDER_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await beforeAbort(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SALESHANDY_RESPONSE_BYTES) throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
    catch { throw new Error('INVALID_PROVIDER_RESPONSE'); }
    return parseSaleshandyResponse(value);
  } finally {
    // Cancel unconsumed data on size, schema, network, or deadline failures.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function saleshandyRequest(path: string, init: RequestInit = {}, fetcher = fetch) {
  if (!process.env.SALESHANDY_API_KEY || !process.env.SALESHANDY_BASE_URL) throw new Error('PROVIDER_NOT_CONFIGURED');
  const base = process.env.SALESHANDY_BASE_URL.replace(/\/$/, '').replace(/\/v1$/, '');
  const url = new URL(`${base}/v1${path}`);
  if (url.protocol !== 'https:') throw new Error('INVALID_PROVIDER_URL');
  const signal = AbortSignal.timeout(SALESHANDY_TIMEOUT_MS);
  // One deadline includes headers AND streamed body; never retry a paid POST.
  const response = await beforeAbort(fetcher(url, {...init, signal, headers: {'x-api-key': process.env.SALESHANDY_API_KEY, 'Content-Type': 'application/json'}}), signal);
  return readSaleshandyResponse(response, signal);
}

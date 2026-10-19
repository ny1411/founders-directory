export async function saleshandyRequest(path: string, init: RequestInit = {}, fetcher = fetch) {
  if (!process.env.SALESHANDY_API_KEY || !process.env.SALESHANDY_BASE_URL) throw new Error('PROVIDER_NOT_CONFIGURED');
  const base = process.env.SALESHANDY_BASE_URL.replace(/\/$/, '').replace(/\/v1$/, '');
  const url = new URL(`${base}/v1${path}`);
  if (url.protocol !== 'https:') throw new Error('INVALID_PROVIDER_URL');
  const response = await fetcher(url, {...init, signal: AbortSignal.timeout(10_000), headers: {'x-api-key': process.env.SALESHANDY_API_KEY, 'Content-Type': 'application/json'}});
  if (!response.ok) throw new Error('PROVIDER_ERROR');
  return response.json();
}

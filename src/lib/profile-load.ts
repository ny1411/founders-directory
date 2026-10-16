export type ProfileLoadState = 'loading' | 'ready' | 'empty' | 'auth-error' | 'backend-error';

export type ProfileLoadResult =
  | { state: 'ready'; resumeText: string }
  | { state: Exclude<ProfileLoadState, 'loading' | 'ready'> };

type ProfileResponse = Pick<Response, 'ok' | 'status' | 'json'>;

/**
 * Interprets the profile endpoint without treating an expected missing profile
 * as a server failure. Invalid success payloads remain failures so callers never
 * enable editing while saved data may be unavailable.
 */
export async function readProfileResponse(response: ProfileResponse): Promise<ProfileLoadResult> {
  if (response.status === 401 || response.status === 403) {
    return { state: 'auth-error' };
  }

  if (response.status === 404) {
    return { state: 'empty' };
  }

  if (!response.ok) {
    return { state: 'backend-error' };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { state: 'backend-error' };
  }

  if (!data || typeof data !== 'object' || !('resumeText' in data)) {
    return { state: 'backend-error' };
  }

  const { resumeText } = data as { resumeText: unknown };
  if (resumeText == null || resumeText === '') {
    return { state: 'empty' };
  }

  if (typeof resumeText !== 'string') {
    return { state: 'backend-error' };
  }

  return { state: 'ready', resumeText };
}

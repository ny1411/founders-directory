import type { User } from 'firebase/auth';

export async function syncAuthenticatedUser(
  user: Pick<User, 'getIdToken'>,
  request: typeof fetch = fetch,
) {
  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await request('/api/auth/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('Could not finish signing in. Check your connection and try again.');
  }
  if (!response.ok) {
    throw new Error('Could not finish signing in. Please try again.');
  }
}

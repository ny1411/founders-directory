import type { User } from 'firebase/auth';

export async function syncAuthenticatedUser(
  user: Pick<User, 'getIdToken'>,
  request: typeof fetch = fetch,
) {
  const token = await user.getIdToken();
  const response = await request('/api/auth/sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error('Could not finish signing in. Please try again.');
  }
}

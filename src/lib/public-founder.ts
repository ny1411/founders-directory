import type { Founder } from './types';

export type PublicFounder = Pick<Founder, 'id' | 'companyId' | 'name' | 'role' | 'avatarUrl' | 'twitterUrl' | 'linkedinUrl' | 'bio'>;

/** Explicit allowlist: newly added private fields must never enter public Flight props. */
export function publicFounder(founder: PublicFounder): PublicFounder {
  const {id, companyId, name, role, avatarUrl, twitterUrl, linkedinUrl, bio} = founder;
  return {id, companyId, name, role, avatarUrl, twitterUrl, linkedinUrl, bio};
}

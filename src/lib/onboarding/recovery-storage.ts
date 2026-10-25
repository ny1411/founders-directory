const PREFIX = 'onboarding-draft:';
const OWNER = 'onboarding-recovery-owner';

/** Auth callbacks run before publishing a changed user to React consumers. */
export function setRecoveryOwner(uid: string | null) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX) && (!uid || !key.endsWith(`:${uid}`))) localStorage.removeItem(key);
    }
    if (uid) sessionStorage.setItem(OWNER, uid);
    else sessionStorage.removeItem(OWNER);
  } catch { /* Storage unavailable. Recovery is best effort. */ }
}

export function readRecovery(uid: string, key: string) {
  try { return sessionStorage.getItem(OWNER) === uid ? localStorage.getItem(key) : null; }
  catch { return null; }
}

export function writeRecovery(uid: string, key: string, value: string) {
  try {
    // Old-account promises/timers cannot recreate a draft after auth changes.
    if (sessionStorage.getItem(OWNER) === uid) localStorage.setItem(key, value);
  } catch { /* Storage unavailable. */ }
}

export function removeRecovery(key: string) {
  try { localStorage.removeItem(key); } catch { /* Storage unavailable. */ }
}

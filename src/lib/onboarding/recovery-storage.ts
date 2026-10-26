const PREFIX = 'onboarding-draft:';
const OWNER = 'onboarding-recovery-owner';
// Storage can fail independently (for example, an unavailable localStorage
// alongside a readable sessionStorage). Never let a stale persisted owner
// authorize old-account callbacks after a failed auth transition.
let activeOwner: string | null = null;

/** Auth callbacks run before publishing a changed user to React consumers. */
export function setRecoveryOwner(uid: string | null) {
  activeOwner = null;
  try {
    sessionStorage.removeItem(OWNER);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX) && (!uid || !key.endsWith(`:${uid}`))) localStorage.removeItem(key);
    }
    if (uid) sessionStorage.setItem(OWNER, uid);
    activeOwner = uid;
  } catch { /* Storage unavailable. Recovery is best effort. */ }
}

export function readRecovery(uid: string, key: string) {
  try { return activeOwner === uid && sessionStorage.getItem(OWNER) === uid ? localStorage.getItem(key) : null; }
  catch { return null; }
}

export function writeRecovery(uid: string, key: string, value: string) {
  try {
    // Old-account promises/timers cannot recreate a draft after auth changes.
    if (activeOwner === uid && sessionStorage.getItem(OWNER) === uid) localStorage.setItem(key, value);
  } catch { /* Storage unavailable. */ }
}

export function removeRecovery(key: string) {
  try { localStorage.removeItem(key); } catch { /* Storage unavailable. */ }
}

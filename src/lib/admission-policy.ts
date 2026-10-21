import type { Firestore } from 'firebase-admin/firestore';
import { requestIp, reserveQuota, type QuotaLimit } from './rate-limit';

export type AdmissionPolicy = 'auth-sync' | 'profile-read' | 'profile-write' | 'company-submit' | 'resume-upload';
export type AdmissionResult = { allowed: boolean; retryAfterSeconds: number };
export type AdmissionCheck = (uid: string, request: Request) => Promise<AdmissionResult>;

// These are origin budgets, independent of paid-provider allowances and BotID.
// Profile aliases deliberately use the same policy/scope in both route modules.
export const ADMISSION_POLICIES: Record<AdmissionPolicy, QuotaLimit[]> = {
  'auth-sync': [
    { name: 'user-minute', subject: 'user', limit: 10, windowMs: 60_000 },
    { name: 'ip-minute', subject: 'ip', limit: 30, windowMs: 60_000 },
  ],
  'profile-read': [
    { name: 'user-minute', subject: 'user', limit: 60, windowMs: 60_000 },
    { name: 'ip-minute', subject: 'ip', limit: 180, windowMs: 60_000 },
  ],
  'profile-write': [
    { name: 'user-minute', subject: 'user', limit: 40, windowMs: 60_000 },
    { name: 'user-hour', subject: 'user', limit: 600, windowMs: 3_600_000 },
    { name: 'user-day', subject: 'user', limit: 2_000, windowMs: 86_400_000 },
    { name: 'ip-minute', subject: 'ip', limit: 120, windowMs: 60_000 },
  ],
  'company-submit': [
    { name: 'user-hour', subject: 'user', limit: 3, windowMs: 3_600_000 },
    { name: 'user-day', subject: 'user', limit: 10, windowMs: 86_400_000 },
    { name: 'ip-hour', subject: 'ip', limit: 10, windowMs: 3_600_000 },
    { name: 'ip-day', subject: 'ip', limit: 30, windowMs: 86_400_000 },
  ],
  'resume-upload': [
    { name: 'user-minute', subject: 'user', limit: 5, windowMs: 60_000 },
    { name: 'user-day', subject: 'user', limit: 30, windowMs: 86_400_000 },
    { name: 'ip-minute', subject: 'ip', limit: 15, windowMs: 60_000 },
    { name: 'ip-day', subject: 'ip', limit: 90, windowMs: 86_400_000 },
  ],
};

export function reserveAdmission(db: Firestore, policy: AdmissionPolicy, uid: string, headers: Headers) {
  return reserveQuota(db, `admission:${policy}`, uid, requestIp({ headers }), ADMISSION_POLICIES[policy]);
}

export function createAdmissionCheck(db: Firestore, policy: AdmissionPolicy): AdmissionCheck {
  return (uid, request) => reserveAdmission(db, policy, uid, request.headers);
}

// Checks must be supplied by production wiring and fixtures. Missing/broken
// configuration fails closed, never silently disables admission.
export async function admissionResponse(check: AdmissionCheck, uid: string, request: Request): Promise<Response | null> {
  try {
    const result = await check(uid, request);
    if (result.allowed) return null;
    return Response.json({ error: 'Too many requests. Please try again later.' }, {
      status: 429,
      headers: { 'Retry-After': String(result.retryAfterSeconds), 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return Response.json({ error: 'Request limits are temporarily unavailable. Try again later.' }, {
      status: 503,
      headers: { 'Retry-After': '30', 'Cache-Control': 'private, no-store' },
    });
  }
}

import { MAX_RESUME_BYTES, RESUME_SIZE_ERROR, RESUME_TYPE_ERROR } from './resume-upload';

// Allow bounded multipart headers/fields in addition to the PDF itself.
export const MAX_RESUME_REQUEST_BYTES = MAX_RESUME_BYTES + 64 * 1024;

interface Dependencies {
  verifyToken: (token: string) => Promise<{ uid: string }>;
  reserveAttempt: (uid: string) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  extract: (pdf: Buffer) => Promise<string>;
}

function failure(error: string, status: number, headers?: HeadersInit) {
  return Response.json({ error }, { status, headers });
}

export function createResumeExtractionHandler(deps: Dependencies) {
  return async function POST(req: Request): Promise<Response> {
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
    if (!token) return failure('Sign in again to upload your resume.', 401);
    let uid: string;
    try {
      uid = (await deps.verifyToken(token)).uid;
      if (!uid) return failure('Sign in again to upload your resume.', 401);
    } catch {
      return failure('Your session has expired. Sign in again to upload your resume.', 401);
    }

    const contentLength = req.headers.get('content-length');
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)))) {
      return failure('Invalid upload length.', 400);
    }
    if (contentLength !== null && Number(contentLength) > MAX_RESUME_REQUEST_BYTES) {
      return failure(RESUME_SIZE_ERROR, 413);
    }
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) {
      return failure('Upload your PDF as a file.', 415);
    }

    let file: File;
    try {
      if (!req.body) return failure('No file uploaded.', 400);
      const reader = req.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESUME_REQUEST_BYTES) {
            await reader.cancel();
            return failure(RESUME_SIZE_ERROR, 413);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const body = Buffer.concat(chunks, size);
      const form = await new Response(body, { headers: { 'content-type': req.headers.get('content-type')! } }).formData();
      const files = form.getAll('file');
      if (files.length !== 1 || !(files[0] instanceof File)) return failure('Upload one PDF resume.', 400);
      file = files[0];
    } catch {
      return failure('The upload could not be read. Choose your PDF and try again.', 400);
    }

    if (file.size > MAX_RESUME_BYTES) return failure(RESUME_SIZE_ERROR, 413);
    if (file.type !== 'application/pdf' || file.size < 5) return failure(RESUME_TYPE_ERROR, 415);
    const pdf = Buffer.from(await file.arrayBuffer());
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) return failure(RESUME_TYPE_ERROR, 415);

    try {
      const allowance = await deps.reserveAttempt(uid);
      if (!allowance.allowed) {
        return failure('Resume upload limit reached (5 attempts per 10 minutes). Try again later.', 429, {
          'Retry-After': String(allowance.retryAfterSeconds),
        });
      }
    } catch {
      // Fail closed: never incur model charges if usage protection is unavailable.
      return failure('Resume uploads are temporarily unavailable. Try again later.', 503);
    }

    try {
      const parsed: unknown = JSON.parse(await deps.extract(pdf));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid resume response');
      return Response.json({ text: JSON.stringify(parsed, null, 2) });
    } catch {
      return failure('Unable to extract this resume. Your existing resume is unchanged. Try again later.', 502);
    }
  };
}

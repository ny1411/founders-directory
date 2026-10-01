import type { Firestore } from 'firebase-admin/firestore';
import type { parseCompany } from './yc-company';
import { retry } from './yc-runner';

export function retryableDatabaseError(error: unknown) {
  const code = (error as { code?: number | string })?.code;
  return [4, 8, 10, 13, 14, 'deadline-exceeded', 'resource-exhausted',
    'aborted', 'internal', 'unavailable'].includes(code ?? '');
}

export async function saveCompany(
  db: Firestore, details: ReturnType<typeof parseCompany>, runId: string,
  retryDelayMs?: number,
): Promise<boolean> {
  const slug = details.company.slug;
  const companyRef = db.collection('companies').doc(slug);
  const timestamp = new Date().toISOString();
  return retry(() => db.runTransaction(async transaction => {
    // Old records have random IDs; checking slug preserves compatibility.
    const existing = await transaction.get(db.collection('companies')
      .where('slug', '==', slug).limit(1));
    if (!existing.empty) {
      // A lost commit response must not create duplicates on retry.
      return existing.docs[0].get('scrapeRunId') === runId;
    }
    const sameId = await transaction.get(companyRef);
    if (sameId.exists) throw new Error(`Company document ID conflict for ${slug}.`);
    transaction.create(companyRef, {
      ...details.company, id: companyRef.id, scrapeRunId: runId,
      createdAt: timestamp, updatedAt: timestamp,
    });
    details.founders.forEach((founder, index) => {
      const founderRef = db.collection('founders').doc(`${companyRef.id}-${index}`);
      transaction.create(founderRef, {
        ...founder, id: founderRef.id, companyId: companyRef.id,
        createdAt: timestamp, updatedAt: timestamp,
      });
    });
    return true;
  }), `Save ${slug}`, { retryable: retryableDatabaseError, delayMs: retryDelayMs });
}

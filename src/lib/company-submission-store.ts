import type { Firestore } from 'firebase-admin/firestore'
import type { CompanySubmission } from './company-submission'

/** A deterministic ID is also used by the scraper, so both writers contend on the same document. */
export async function storeCompanySubmission(db: Firestore, submission: CompanySubmission): Promise<boolean> {
  const { company, founders } = submission
  const companyRef = db.collection('companies').doc(company.slug)
  const timestamp = new Date().toISOString()
  return db.runTransaction(async transaction => {
    // Legacy companies used random IDs; do not overwrite or duplicate them.
    const existing = await transaction.get(db.collection('companies').where('slug', '==', company.slug).limit(1))
    const sameId = await transaction.get(companyRef)
    if (!existing.empty || sameId.exists) return false
    transaction.create(companyRef, {
      ...company, id: companyRef.id, oneLiner: null, tags: null, batch: null, ycUrl: null,
      createdAt: timestamp, updatedAt: timestamp,
    })
    founders.forEach((founder, index) => {
      const ref = db.collection('founders').doc(`${companyRef.id}-${index}`)
      transaction.create(ref, { ...founder, id: ref.id, companyId: companyRef.id, createdAt: timestamp, updatedAt: timestamp })
    })
    return true
  })
}

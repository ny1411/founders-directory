/** Read-only audit of a locally exported JSON array; never connects to Firestore. */
import { readFileSync } from 'node:fs'
import { validateCompanySubmission } from '../../src/lib/company-submission'

const file = process.argv[2]
if (!file) throw new Error('Usage: npx tsx scripts/company/audit-submissions.ts /path/to/companies.json')
const records: unknown = JSON.parse(readFileSync(file, 'utf8'))
if (!Array.isArray(records)) throw new Error('Expected an array of company documents including id.')
const slugs = new Map<string, string[]>()
const issues: Array<{ id: string; fields: Record<string, string> }> = []
for (const record of records) {
  if (!record || typeof record !== 'object' || typeof record.id !== 'string') throw new Error('Every exported document must include its id.')
  const data = new FormData()
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && value !== undefined) data.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
  data.set('founder_0_name', 'Audit placeholder')
  const fields = validateCompanySubmission(data).fieldErrors ?? {}
  const canonical = typeof record.slug === 'string' ? record.slug.trim().toLowerCase() : ''
  if (canonical !== record.slug) fields.slug = 'Slug is missing or is not canonical lowercase text.'
  if (canonical) slugs.set(canonical, [...(slugs.get(canonical) ?? []), record.id])
  if (Object.keys(fields).length) issues.push({ id: record.id, fields })
}
console.log(JSON.stringify({ issues, duplicateSlugs: [...slugs].filter(([, ids]) => ids.length > 1).map(([slug, ids]) => ({ slug, ids })) }, null, 2))

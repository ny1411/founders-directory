import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateCompanySubmission } from './company-submission'
import { storeCompanySubmission } from './company-submission-store'
import type { Firestore } from 'firebase-admin/firestore'

function form() {
  const data = new FormData()
  data.set('name', ' Acme ')
  data.set('slug', ' ACME ')
  data.set('founder_0_name', ' Founder ')
  return data
}

test('valid input normalizes optional fields and preserves a nullable stage', () => {
  const data = form()
  assert.equal(validateCompanySubmission(data).data?.company.stage, null)
  data.set('stage', ' Series A ')
  data.set('employees', '0')
  const result = validateCompanySubmission(data).data!
  assert.equal(result.company.stage, 'Series A')
  assert.equal(result.company.slug, 'acme')
  assert.equal(result.company.name, 'Acme')
  assert.equal(result.company.employees, 0)
  assert.equal(result.founders[0].role, null)
  data.set('stage', '  ')
  assert.equal(validateCompanySubmission(data).data?.company.stage, null)
})

test('all supplied scalar values reject files and repeated values', () => {
  for (const key of ['name', 'slug', 'description', 'website', 'logoUrl', 'vcBacker', 'industry', 'employees', 'location', 'foundedYear', 'stage', 'twitterUrl', 'linkedinUrl', 'founder_0_name', 'founder_0_role', 'founder_0_email', 'founder_0_phone', 'founder_0_avatarUrl', 'founder_0_twitterUrl', 'founder_0_linkedinUrl', 'founder_0_bio']) {
    const data = form()
    data.set(key, new Blob(['file']), 'file.txt')
    assert.ok(validateCompanySubmission(data).fieldErrors?.[key], key)
    data.set(key, 'first')
    data.append(key, 'second')
    assert.ok(validateCompanySubmission(data).fieldErrors?.[key], key)
  }
})

test('employees is a nonnegative safe integer or null, never NaN', () => {
  for (const value of ['50-100', 'NaN', 'Infinity', '-1', '1.2', '1e3', '9007199254740992']) {
    const data = form(); data.set('employees', value)
    assert.ok(validateCompanySubmission(data).fieldErrors?.employees, value)
  }
  for (const value of ['', '   ', '10']) {
    const data = form(); data.set('employees', value)
    const result = validateCompanySubmission(data).data!
    assert.equal(result.company.employees, value.trim() ? 10 : null)
  }
})

test('required text, lengths, slug, years, URLs, email and founder bounds are validated', () => {
  const cases: Array<[string, string]> = [
    ['name', ' '], ['name', 'a'.repeat(201)], ['slug', '../escape'], ['slug', 'new'], ['slug', ' NEW '], ['description', 'a'.repeat(10001)],
    ['stage', 'a'.repeat(101)], ['foundedYear', '2020abc'], ['foundedYear', '99999'],
    ['website', 'javascript:alert(1)'], ['logoUrl', 'data:image/png,abc'], ['twitterUrl', '//example.com'],
    ['linkedinUrl', 'https://user:pass@example.com'], ['founder_0_avatarUrl', 'file:///tmp/a'],
    ['founder_0_email', 'invalid'], ['founder_0_name', ''],
  ]
  for (const [key, value] of cases) {
    const data = form(); data.set(key, value)
    assert.ok(validateCompanySubmission(data).fieldErrors?.[key], `${key}: ${value}`)
  }
  for (const key of ['founder_10_name', 'founder_2_name', 'founder_x_name']) {
    const data = form(); data.set(key, 'Founder')
    assert.ok(validateCompanySubmission(data).fieldErrors?.founders)
  }
  const valid = form(); valid.set('website', 'https://example.com/a?q=b'); valid.set('logoUrl', 'http://example.com/logo.png')
  assert.ok(validateCompanySubmission(valid).data)
})

// Serializes transaction callbacks to model Firestore retries on a contended
// document. The assertion exercises real store queries and atomic document IDs.
function database(initial: Array<[string, Record<string, unknown>]> = []) {
  const documents = new Map(initial)
  let lock = Promise.resolve()
  const db = {
    collection(collection: string) {
      return { doc: (id: string) => ({ id, path: `${collection}/${id}` }),
        where: (_field: string, _op: string, slug: string) => ({ limit: () => ({ slug }) }) }
    },
    runTransaction: (callback: (transaction: unknown) => Promise<boolean>) => {
      const result = lock.then(async () => {
        const pending = new Map<string, Record<string, unknown>>()
        const transaction = {
          async get(ref: { path?: string; slug?: string }) {
            assert.equal(pending.size, 0, 'all reads precede writes')
            if (ref.path) return { exists: documents.has(ref.path), data: () => documents.get(ref.path!) }
            return { empty: ![...documents].some(([path, value]) => path.startsWith('companies/') && value.slug === ref.slug) }
          },
          set(ref: { path: string }, value: Record<string, unknown>) { pending.set(ref.path, value) },
          create(ref: { path: string }, value: Record<string, unknown>) {
            assert.ok(!documents.has(ref.path))
            pending.set(ref.path, value)
          },
        }
        const saved = await callback(transaction)
        for (const [path, value] of pending) documents.set(path, value)
        return saved
      })
      lock = result.then(() => {})
      return result
    },
  }
  return { db: db as unknown as Firestore, documents }
}

test('concurrent submissions save one company and founder set, including stage', async () => {
  const data = form(); data.set('stage', 'Seed')
  const parsed = validateCompanySubmission(data).data!
  const { db, documents } = database()
  assert.deepEqual(await Promise.all([storeCompanySubmission(db, parsed), storeCompanySubmission(db, parsed)]), [true, false])
  assert.equal(documents.size, 3)
  assert.equal(documents.get('companies/acme')?.stage, 'Seed')
  assert.equal(documents.get('founders/acme-0')?.companyId, 'acme')
})

test('legacy random-ID slugs and occupied deterministic IDs are preserved without writes', async () => {
  for (const initial of [[['companies/random-id', { slug: 'acme' }]], [['companies/acme', { slug: 'different' }]]] as Array<Array<[string, Record<string, unknown>]>>) {
    const { db, documents } = database(initial)
    assert.equal(await storeCompanySubmission(db, validateCompanySubmission(form()).data!), false)
    assert.deepEqual([...documents], initial)
  }
})

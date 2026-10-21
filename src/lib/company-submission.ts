import { normalizeImageUrl } from './image-url'

/** The same limits apply to browser forms and independently called server actions. */
export const MAX_FOUNDERS = 10
export type CompanySubmissionResult = { error: string; fieldErrors?: Record<string, string> }
export type CompanySubmission = {
  company: { name: string; slug: string; description: string | null; website: string | null;
    logoUrl: string | null; vcBacker: string | null; industry: string | null; employees: number | null;
    location: string | null; foundedYear: number | null; stage: string | null;
    twitterUrl: string | null; linkedinUrl: string | null }
  founders: Array<{ name: string; role: string | null; email: string | null; phone: string | null;
    avatarUrl: string | null; twitterUrl: string | null; linkedinUrl: string | null; bio: string | null }>
}

export function validateCompanySubmission(form: FormData):
  { data: CompanySubmission; fieldErrors?: never } | { data?: never; fieldErrors: Record<string, string> } {
  const errors: Record<string, string> = {}
  function text(key: string, max: number, required = false): string | null {
    const entries = form.getAll(key)
    if (entries.length > 1 || entries.some(value => typeof value !== 'string')) {
      errors[key] = 'Provide a single text value.'
      return null
    }
    const value = typeof entries[0] === 'string' ? entries[0].trim() : ''
    if (required && !value) errors[key] = 'This field is required.'
    if (value.length > max) errors[key] = `Use ${max} characters or fewer.`
    return value || null
  }
  function url(key: string) {
    const value = text(key, 2048)
    if (value) {
      try {
        const parsed = new URL(value)
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error()
      } catch { errors[key] = 'Enter a full http:// or https:// URL without login credentials.' }
    }
    return value
  }
  function integer(key: string, max: number, min = 0) {
    const value = text(key, 20)
    if (value === null) return null
    const number = Number(value)
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
      errors[key] = `Enter a whole number from ${min} to ${max}, or leave blank.`
      return null
    }
    return number
  }
  function image(key: string) {
    const value = text(key, 2048)
    if (!value) return null
    const normalized = normalizeImageUrl(value)
    if (!normalized) errors[key] = 'Use a supported YC or Clearbit image URL, a site image path, or leave this blank.'
    return normalized
  }
  const name = text('name', 200, true) ?? ''
  const slug = (text('slug', 200, true) ?? '').toLowerCase()
  if (slug === 'new') errors.slug = 'This URL slug is reserved. Choose a different slug.'
  if (slug && !/^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(slug)) errors.slug = 'Use letters, numbers, and hyphens; start and end with a letter or number.'
  const company = {
    name, slug, description: text('description', 10000), website: url('website'), logoUrl: image('logoUrl'),
    vcBacker: text('vcBacker', 200), industry: text('industry', 200), employees: integer('employees', Number.MAX_SAFE_INTEGER),
    location: text('location', 300), foundedYear: integer('foundedYear', new Date().getUTCFullYear() + 1, 1000),
    stage: text('stage', 100), twitterUrl: url('twitterUrl'), linkedinUrl: url('linkedinUrl'),
  }
  const indices = new Set<number>()
  for (const key of form.keys()) {
    if (!key.startsWith('founder_')) continue
    const match = /^founder_(0|[1-9]\d*)_(name|role|email|phone|avatarUrl|twitterUrl|linkedinUrl|bio)$/.exec(key)
    if (!match || Number(match[1]) >= MAX_FOUNDERS) errors.founders = `Add between 1 and ${MAX_FOUNDERS} founders using consecutive rows.`
    else indices.add(Number(match[1]))
  }
  if (!indices.size || [...indices].some((_, index) => !indices.has(index))) errors.founders = `Add between 1 and ${MAX_FOUNDERS} founders using consecutive rows.`
  const founders = [...indices].sort((a, b) => a - b).map(index => {
    const prefix = `founder_${index}_`
    const email = text(`${prefix}email`, 254)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors[`${prefix}email`] = 'Enter a valid email address.'
    return { name: text(`${prefix}name`, 200, true) ?? '', role: text(`${prefix}role`, 200), email,
      phone: text(`${prefix}phone`, 50), avatarUrl: image(`${prefix}avatarUrl`), twitterUrl: url(`${prefix}twitterUrl`),
      linkedinUrl: url(`${prefix}linkedinUrl`), bio: text(`${prefix}bio`, 5000) }
  })
  return Object.keys(errors).length ? { fieldErrors: errors } : { data: { company, founders } }
}

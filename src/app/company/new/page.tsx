'use client'

import { useState, useEffect, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { createCompany } from '@/app/actions'
import Link from 'next/link'
import { MAX_FOUNDERS, type CompanySubmissionResult } from '@/lib/company-submission'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { BotIdProtection } from '@/components/bot-id-protection'

export default function NewCompanyPage() {
  const [founderCount, setFounderCount] = useState(1)
  const { user, loading } = useAuth()
  const router = useRouter()
  const [submission, setSubmission] = useState<CompanySubmissionResult>({ error: '' })
  const [pending, startTransition] = useTransition()

  function submitCompany(event: FormEvent<HTMLFormElement>) {
    // Native submission keeps uncontrolled fields intact when authentication fails.
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setSubmission({ error: '' })

    startTransition(async () => {
      if (!user) {
        setSubmission({ error: 'Please sign in before adding a company.' })
        return
      }

      let idToken: string
      try {
        idToken = await user.getIdToken(true)
      } catch {
        setSubmission({ error: 'Your session could not be refreshed. Please sign in again.' })
        return
      }

      // Let Next handle the action's redirect exception after a successful save.
      setSubmission(await createCompany(formData, idToken))
    })
  }

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (submission.error) document.getElementById('submission-errors')?.focus()
  }, [submission])

  if (loading || !user) {
    return <div className="max-w-4xl mx-auto py-20 flex justify-center"><div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" /></div>
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-8 pb-20">
      <BotIdProtection />
      <div>
        <Link href="/" className={buttonVariants({ variant: "ghost", className: "mb-4 -ml-4" })}>
          ← Back to Directory
        </Link>
        <h1 className="text-4xl font-bold tracking-tight uppercase mb-2">Add New Company</h1>
        <p className="text-muted-foreground">Fill in the details below to add a new company to the directory.</p>
      </div>

      <form noValidate onSubmit={submitCompany} aria-busy={pending} className="flex flex-col gap-8">
        {submission.error && (
          <div id="submission-errors" tabIndex={-1} role="alert" className="text-destructive flex flex-col gap-2">
            <p>{submission.error}</p>
            {submission.fieldErrors && <ul className="list-disc pl-5">
              {Object.entries(submission.fieldErrors).map(([field, error]) => <li key={field}>
                <a className="underline" href={`#${field}`}>{field.replace(/^founder_(\d+)_/, (_, index) => `Founder ${Number(index) + 1}: `).replace(/([A-Z])/g, ' $1')}: {error}</a>
              </li>)}
            </ul>}
          </div>
        )}
        {/* Company Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Company Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">Company Name *</label>
              <Input id="name" name="name" required placeholder="e.g. Acme Corp" aria-invalid={Boolean(submission.fieldErrors?.['name'])} aria-describedby={submission.fieldErrors?.['name'] ? 'name-error' : undefined} />
              <FieldError name="name" errors={submission.fieldErrors} />
            </div>
            <div className="space-y-2">
              <label htmlFor="slug" className="text-sm font-medium">URL Slug *</label>
              <Input id="slug" name="slug" required placeholder="e.g. acme-corp" aria-invalid={Boolean(submission.fieldErrors?.['slug'])} aria-describedby={submission.fieldErrors?.['slug'] ? 'slug-error' : undefined} />
              <FieldError name="slug" errors={submission.fieldErrors} />
              <p className="text-sm text-muted-foreground">Letters, numbers, and hyphens. The slug “new” is reserved.</p>
            </div>
            
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="description" className="text-sm font-medium">Description</label>
              <textarea 
                id="description" 
                name="description"
                aria-invalid={Boolean(submission.fieldErrors?.description)}
                aria-describedby={submission.fieldErrors?.description ? "description-error" : undefined}
                className="w-full flex min-h-[100px] rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                placeholder="A brief description of the company..."
              />
              <FieldError name="description" errors={submission.fieldErrors} />
            </div>

            <div className="space-y-2">
              <label htmlFor="website" className="text-sm font-medium">Website</label>
              <Input id="website" name="website" placeholder="https://..." aria-invalid={Boolean(submission.fieldErrors?.['website'])} aria-describedby={submission.fieldErrors?.['website'] ? 'website-error' : undefined} />
              <FieldError name="website" errors={submission.fieldErrors} />
            </div>
            <div className="space-y-2">
              <label htmlFor="logoUrl" className="text-sm font-medium">Logo URL</label>
              <Input id="logoUrl" name="logoUrl" placeholder="https://..." aria-invalid={Boolean(submission.fieldErrors?.['logoUrl'])} aria-describedby={submission.fieldErrors?.['logoUrl'] ? 'logoUrl-error' : undefined} />
              <FieldError name="logoUrl" errors={submission.fieldErrors} />
            </div>

            <div className="space-y-2">
              <label htmlFor="vcBacker" className="text-sm font-medium">VC Backer</label>
              <Input id="vcBacker" name="vcBacker" placeholder="e.g. YCombinator" aria-invalid={Boolean(submission.fieldErrors?.['vcBacker'])} aria-describedby={submission.fieldErrors?.['vcBacker'] ? 'vcBacker-error' : undefined} />
              <FieldError name="vcBacker" errors={submission.fieldErrors} />
            </div>
            <div className="space-y-2">
              <label htmlFor="industry" className="text-sm font-medium">Industry</label>
              <Input id="industry" name="industry" placeholder="e.g. Fintech" aria-invalid={Boolean(submission.fieldErrors?.['industry'])} aria-describedby={submission.fieldErrors?.['industry'] ? 'industry-error' : undefined} />
              <FieldError name="industry" errors={submission.fieldErrors} />
            </div>

            <div className="space-y-2">
              <label htmlFor="employees" className="text-sm font-medium">Employees</label>
              <Input id="employees" name="employees" type="number" min="0" step="1" placeholder="e.g. 50" aria-invalid={Boolean(submission.fieldErrors?.['employees'])} aria-describedby={submission.fieldErrors?.['employees'] ? 'employees-error' : undefined} />
              <FieldError name="employees" errors={submission.fieldErrors} />
              <p className="text-sm text-muted-foreground">Enter a whole number, or leave blank if unknown.</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="location" className="text-sm font-medium">Location</label>
              <Input id="location" name="location" placeholder="e.g. San Francisco, CA" aria-invalid={Boolean(submission.fieldErrors?.['location'])} aria-describedby={submission.fieldErrors?.['location'] ? 'location-error' : undefined} />
              <FieldError name="location" errors={submission.fieldErrors} />
            </div>
            
            <div className="space-y-2">
              <label htmlFor="foundedYear" className="text-sm font-medium">Founded Year</label>
              <Input id="foundedYear" name="foundedYear" type="number" placeholder="e.g. 2020" aria-invalid={Boolean(submission.fieldErrors?.['foundedYear'])} aria-describedby={submission.fieldErrors?.['foundedYear'] ? 'foundedYear-error' : undefined} />
              <FieldError name="foundedYear" errors={submission.fieldErrors} />
            </div>
            <div className="space-y-2">
              <label htmlFor="stage" className="text-sm font-medium">Stage</label>
              <Input id="stage" name="stage" placeholder="e.g. Series A" aria-invalid={Boolean(submission.fieldErrors?.['stage'])} aria-describedby={submission.fieldErrors?.['stage'] ? 'stage-error' : undefined} />
              <FieldError name="stage" errors={submission.fieldErrors} />
            </div>
            
            <div className="space-y-2"></div>

            <div className="space-y-2">
              <label htmlFor="twitterUrl" className="text-sm font-medium">Twitter URL</label>
              <Input id="twitterUrl" name="twitterUrl" placeholder="https://twitter.com/..." aria-invalid={Boolean(submission.fieldErrors?.['twitterUrl'])} aria-describedby={submission.fieldErrors?.['twitterUrl'] ? 'twitterUrl-error' : undefined} />
              <FieldError name="twitterUrl" errors={submission.fieldErrors} />
            </div>
            <div className="space-y-2">
              <label htmlFor="linkedinUrl" className="text-sm font-medium">LinkedIn URL</label>
              <Input id="linkedinUrl" name="linkedinUrl" placeholder="https://linkedin.com/company/..." aria-invalid={Boolean(submission.fieldErrors?.['linkedinUrl'])} aria-describedby={submission.fieldErrors?.['linkedinUrl'] ? 'linkedinUrl-error' : undefined} />
              <FieldError name="linkedinUrl" errors={submission.fieldErrors} />
            </div>
          </CardContent>
        </Card>

        {/* Founders */}
        <div id="founders" className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h2 className="text-2xl font-bold tracking-tight uppercase">Founders</h2>
            <Button type="button" variant="outline" disabled={pending || founderCount >= MAX_FOUNDERS} onClick={() => setFounderCount(prev => prev + 1)}>
              + Add Founder
            </Button>
          </div>

          {Array.from({ length: founderCount }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <CardTitle className="text-lg">Founder {i + 1}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label htmlFor={`founder_${i}_name`} className="text-sm font-medium">Name *</label>
                  <Input id={`founder_${i}_name`} name={`founder_${i}_name`} required placeholder="Founder Name" aria-invalid={Boolean(submission.fieldErrors?.[`founder_${i}_name`])} aria-describedby={submission.fieldErrors?.[`founder_${i}_name`] ? `founder_${i}_name-error` : undefined} />
                  <FieldError name={`founder_${i}_name`} errors={submission.fieldErrors} />
                </div>
                <div className="space-y-2">
                  <label htmlFor={`founder_${i}_role`} className="text-sm font-medium">Role</label>
                  <Input id={`founder_${i}_role`} name={`founder_${i}_role`} placeholder="e.g. CEO" aria-invalid={Boolean(submission.fieldErrors?.[`founder_${i}_role`])} aria-describedby={submission.fieldErrors?.[`founder_${i}_role`] ? `founder_${i}_role-error` : undefined} />
                  <FieldError name={`founder_${i}_role`} errors={submission.fieldErrors} />
                </div>
                
                <div className="space-y-2 md:col-span-2">
                  <label htmlFor={`founder_${i}_bio`} className="text-sm font-medium">Bio</label>
                  <textarea 
                    id={`founder_${i}_bio`}
                    name={`founder_${i}_bio`}
                    aria-invalid={Boolean(submission.fieldErrors?.[`founder_${i}_bio`])}
                    aria-describedby={submission.fieldErrors?.[`founder_${i}_bio`] ? `founder_${i}_bio-error` : undefined}
                    className="w-full flex min-h-[80px] rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                    placeholder="Short bio..."
                  />
                  <FieldError name={`founder_${i}_bio`} errors={submission.fieldErrors} />
                </div>

                <div className="space-y-2">
                  <label htmlFor={`founder_${i}_email`} className="text-sm font-medium">Email</label>
                  <Input id={`founder_${i}_email`} name={`founder_${i}_email`} type="email" placeholder="email@example.com" aria-invalid={Boolean(submission.fieldErrors?.[`founder_${i}_email`])} aria-describedby={submission.fieldErrors?.[`founder_${i}_email`] ? `founder_${i}_email-error` : undefined} />
                  <FieldError name={`founder_${i}_email`} errors={submission.fieldErrors} />
                </div>
                <div className="space-y-2">
                  <label htmlFor={`founder_${i}_phone`} className="text-sm font-medium">Phone</label>
                  <Input id={`founder_${i}_phone`} name={`founder_${i}_phone`} placeholder="+1..." aria-invalid={Boolean(submission.fieldErrors?.[`founder_${i}_phone`])} aria-describedby={submission.fieldErrors?.[`founder_${i}_phone`] ? `founder_${i}_phone-error` : undefined} />
                  <FieldError name={`founder_${i}_phone`} errors={submission.fieldErrors} />
                </div>

                <div className="space-y-2">
                  <label htmlFor={`founder_${i}_twitterUrl`} className="text-sm font-medium">Twitter URL</label>
                  <Input id={`founder_${i}_twitterUrl`} name={`founder_${i}_twitterUrl`} placeholder="https://twitter.com/..." aria-invalid={Boolean(submission.fieldErrors?.[`founder_${i}_twitterUrl`])} aria-describedby={submission.fieldErrors?.[`founder_${i}_twitterUrl`] ? `founder_${i}_twitterUrl-error` : undefined} />
                  <FieldError name={`founder_${i}_twitterUrl`} errors={submission.fieldErrors} />
                </div>
                <div className="space-y-2">
                  <label htmlFor={`founder_${i}_linkedinUrl`} className="text-sm font-medium">LinkedIn URL</label>
                  <Input id={`founder_${i}_linkedinUrl`} name={`founder_${i}_linkedinUrl`} placeholder="https://linkedin.com/in/..." aria-invalid={Boolean(submission.fieldErrors?.[`founder_${i}_linkedinUrl`])} aria-describedby={submission.fieldErrors?.[`founder_${i}_linkedinUrl`] ? `founder_${i}_linkedinUrl-error` : undefined} />
                  <FieldError name={`founder_${i}_linkedinUrl`} errors={submission.fieldErrors} />
                </div>
                
                <div className="space-y-2 md:col-span-2">
                  <label htmlFor={`founder_${i}_avatarUrl`} className="text-sm font-medium">Avatar URL</label>
                  <Input id={`founder_${i}_avatarUrl`} name={`founder_${i}_avatarUrl`} placeholder="https://..." aria-invalid={Boolean(submission.fieldErrors?.[`founder_${i}_avatarUrl`])} aria-describedby={submission.fieldErrors?.[`founder_${i}_avatarUrl`] ? `founder_${i}_avatarUrl-error` : undefined} />
                  <FieldError name={`founder_${i}_avatarUrl`} errors={submission.fieldErrors} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Button type="submit" size="lg" disabled={pending} className="w-full md:w-auto self-end">
          {pending ? 'Saving Company…' : 'Save Company'}
        </Button>
      </form>
    </div>
  )
}

function FieldError({ name, errors }: { name: string; errors?: Record<string, string> }) {
  return errors?.[name] ? <p id={`${name}-error`} className="text-sm text-destructive">{errors[name]}</p> : null
}

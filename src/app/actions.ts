'use server'

import { instrumentCompanySubmission } from "@/lib/observability-runtime"
import { reserveAdmission } from "@/lib/admission-policy"
import { adminAuth, adminDb } from "@/lib/firebase-admin"
import { DIRECTORY_CACHE_TAG } from "@/lib/directory-cache"
import { verifyBotRequest } from "@/lib/bot-verification"
import { companyCacheTag } from "@/lib/company-query"
import { validateCompanySubmission, type CompanySubmissionResult } from "@/lib/company-submission"
import { storeCompanySubmission } from "@/lib/company-submission-store"
import { revalidatePath, revalidateTag } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

export async function createCompany(formData: FormData, idToken: string): Promise<CompanySubmissionResult> {
  return instrumentCompanySubmission(() => createCompanyAction(formData, idToken))
}

async function createCompanyAction(formData: FormData, idToken: string): Promise<CompanySubmissionResult> {
  if (typeof idToken !== 'string' || !idToken.trim()) {
    return { error: 'Please sign in before adding a company.' }
  }

  let identity
  try {
    // Client-side redirects do not protect this independently callable action.
    identity = await adminAuth.verifyIdToken(idToken, true)
  } catch {
    return { error: 'Your session could not be verified. Please sign in again.' }
  }

  const requestHeaders = await headers()
  const botVerification = await verifyBotRequest(requestHeaders, '/company/new')
  if (!botVerification.allowed) return { error: botVerification.message }

  try {
    const admission = await reserveAdmission(adminDb, 'company-submit', identity.uid, requestHeaders)
    if (!admission.allowed) return {
      error: `Company submission limit reached. Try again in ${admission.retryAfterSeconds} seconds.`,
      code: 'RATE_LIMITED', retryAfterSeconds: admission.retryAfterSeconds,
    }
  } catch {
    return { error: 'Company submission limits are temporarily unavailable. Try again later.', code: 'LIMIT_UNAVAILABLE', retryAfterSeconds: 30 }
  }

  const validated = validateCompanySubmission(formData)
  if (!validated.data) return { error: 'Check the highlighted fields and try again.', fieldErrors: validated.fieldErrors }
  const { slug } = validated.data.company

  try {
    const saved = await storeCompanySubmission(adminDb, validated.data)
    if (!saved) return {
      error: 'That company slug is already in use. Choose a different URL slug.',
      fieldErrors: { slug: 'This URL slug is already in use.' },
    }
  } catch {
    console.error('Company submission failed')
    return { error: 'Could not save the company. Please try again.', code: 'SAVE_FAILED' }
  }

  revalidateTag(DIRECTORY_CACHE_TAG)
  revalidateTag(companyCacheTag(slug))
  revalidatePath(`/company/${slug}`)
  revalidatePath('/')
  redirect(`/company/${slug}`)
}

'use server'

import { adminAuth, adminDb } from "@/lib/firebase-admin"
import { DIRECTORY_CACHE_TAG } from "@/lib/directory-cache"
import { verifyBotRequest } from "@/lib/bot-verification"
import { companyCacheTag, normalizeCompanySlug } from "@/lib/company-query"
import { revalidatePath, revalidateTag } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

export async function createCompany(formData: FormData, idToken: string): Promise<{ error: string }> {
  if (typeof idToken !== 'string' || !idToken.trim()) {
    return { error: 'Please sign in before adding a company.' }
  }

  try {
    // Client-side redirects do not protect this independently callable action.
    await adminAuth.verifyIdToken(idToken, true)
  } catch {
    return { error: 'Your session could not be verified. Please sign in again.' }
  }

  const botVerification = await verifyBotRequest(await headers(), '/company/new')
  if (!botVerification.allowed) return { error: botVerification.message }

  const name = formData.get('name') as string
  const slug = normalizeCompanySlug(String(formData.get('slug') ?? ''))
  if (!slug) return { error: 'Enter a valid company slug using letters, numbers, and hyphens.' }
  const description = formData.get('description') as string
  const website = formData.get('website') as string
  const logoUrl = formData.get('logoUrl') as string
  const vcBacker = formData.get('vcBacker') as string
  const industry = formData.get('industry') as string
  const employeesStr = formData.get('employees') as string
  const employees = employeesStr ? Number(employeesStr) : null
  const location = formData.get('location') as string
  const foundedYear = formData.get('foundedYear') ? parseInt(formData.get('foundedYear') as string) : null
  const twitterUrl = formData.get('twitterUrl') as string
  const linkedinUrl = formData.get('linkedinUrl') as string

  try {
    const companyRef = adminDb.collection('companies').doc();
    const companyId = companyRef.id;

    const batch = adminDb.batch();

    batch.set(companyRef, {
      id: companyId,
      name,
      slug,
      description,
      website,
      logoUrl,
      vcBacker,
      industry,
      employees,
      location,
      foundedYear,
      twitterUrl,
      linkedinUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Parse founders
    let i = 0
    while (formData.has(`founder_${i}_name`)) {
      const fName = formData.get(`founder_${i}_name`) as string
      if (fName) {
        const founderRef = adminDb.collection('founders').doc();
        batch.set(founderRef, {
          id: founderRef.id,
          companyId: companyId,
          name: fName,
          role: formData.get(`founder_${i}_role`) as string || null,
          email: formData.get(`founder_${i}_email`) as string || null,
          phone: formData.get(`founder_${i}_phone`) as string || null,
          avatarUrl: formData.get(`founder_${i}_avatarUrl`) as string || null,
          twitterUrl: formData.get(`founder_${i}_twitterUrl`) as string || null,
          linkedinUrl: formData.get(`founder_${i}_linkedinUrl`) as string || null,
          bio: formData.get(`founder_${i}_bio`) as string || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      i++
    }

    await batch.commit();
  } catch (error) {
    console.error('Company submission failed', error)
    return { error: 'Could not save the company. Please try again.' }
  }

  revalidateTag(DIRECTORY_CACHE_TAG)
  revalidateTag(companyCacheTag(slug))
  revalidatePath(`/company/${slug}`)
  revalidatePath('/')
  redirect(`/company/${slug}`)
}

'use server'

import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

export async function createCompany(formData: FormData) {
  const name = formData.get('name') as string
  const slug = formData.get('slug') as string
  const description = formData.get('description') as string
  const website = formData.get('website') as string
  const logoUrl = formData.get('logoUrl') as string
  const vcBacker = formData.get('vcBacker') as string
  const industry = formData.get('industry') as string
  const employees = formData.get('employees') as string
  const location = formData.get('location') as string
  const foundedYear = formData.get('foundedYear') ? parseInt(formData.get('foundedYear') as string) : null
  const twitterUrl = formData.get('twitterUrl') as string
  const linkedinUrl = formData.get('linkedinUrl') as string

  // Parse founders
  const founders: { name: string, role: string | null, email: string | null, phone: string | null, avatarUrl: string | null, twitterUrl: string | null, linkedinUrl: string | null, bio: string | null }[] = []
  let i = 0
  while (formData.has(`founder_${i}_name`)) {
    const fName = formData.get(`founder_${i}_name`) as string
    if (fName) {
      founders.push({
        name: fName,
        role: formData.get(`founder_${i}_role`) as string || null,
        email: formData.get(`founder_${i}_email`) as string || null,
        phone: formData.get(`founder_${i}_phone`) as string || null,
        avatarUrl: formData.get(`founder_${i}_avatarUrl`) as string || null,
        twitterUrl: formData.get(`founder_${i}_twitterUrl`) as string || null,
        linkedinUrl: formData.get(`founder_${i}_linkedinUrl`) as string || null,
        bio: formData.get(`founder_${i}_bio`) as string || null,
      })
    }
    i++
  }

  await prisma.company.create({
    data: {
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
      founders: {
        create: founders
      }
    }
  })

  revalidatePath('/')
  redirect(`/company/${slug}`)
}

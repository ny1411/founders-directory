import { MetadataRoute } from 'next'
import { adminDb } from "@/lib/firebase-admin"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://foundersdirectory.com';

  const companiesSnapshot = await adminDb.collection("companies").get();
  const companyUrls = companiesSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      url: `${baseUrl}/company/${data.slug}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    };
  });

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...companyUrls,
  ]
}

import type { MetadataRoute } from 'next'
import { getDirectoryIndex } from '@/lib/directory-query'
import { buildSitemap } from '@/lib/sitemap'

// Cache successful metadata and retry temporary root-only outage responses.
export const revalidate = 300

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = new URL(
    process.env.NEXT_PUBLIC_APP_URL || 'https://foundersdirectory.com'
  );

  return buildSitemap(baseUrl, getDirectoryIndex)
}

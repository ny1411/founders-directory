import { load } from 'cheerio';
import type { APIRequestContext } from 'playwright';
import type { YCCompany } from './yc-directory';
import { normalizeImageUrl } from '../../src/lib/image-url';

interface PublicFounder {
  user_id?: number;
  full_name: string;
  title?: string;
  founder_bio?: string;
  linkedin_url?: string;
  twitter_url?: string;
}

interface PublicCompany {
  slug: string;
  name: string;
  one_liner?: string;
  long_description?: string;
  website?: string;
  linkedin_url?: string;
  twitter_url?: string;
  small_logo_url?: string;
  year_founded?: number;
  team_size?: number;
  location?: string;
  batch_name?: string;
  tags?: string[];
  founders: PublicFounder[];
}

export function parseCompany(html: string, listing: YCCompany) {
  const $ = load(html);
  const raw = $('[data-page]').attr('data-page');
  if (!raw) throw new Error(`Missing YC company data for ${listing.slug}.`);
  const data = JSON.parse(raw).props?.company as PublicCompany | undefined;
  if (!data || data.slug !== listing.slug || !data.name?.trim() || !Array.isArray(data.founders)) {
    throw new Error(`Invalid or redirected YC profile for ${listing.slug}.`);
  }
  const founders = [...new Map(data.founders.filter(founder => founder.full_name?.trim())
    .map(founder => [founder.user_id ?? founder.full_name, {
      name: founder.full_name.trim(),
      role: founder.title || 'Founder',
      bio: founder.founder_bio || '',
      linkedinUrl: founder.linkedin_url || null,
      twitterUrl: founder.twitter_url || null,
    }])).values()];

  return {
    company: {
      slug: listing.slug,
      name: data.name.trim(),
      oneLiner: data.one_liner || listing.one_liner || '',
      description: data.long_description || listing.long_description || '',
      website: data.website || listing.website || null,
      twitterUrl: data.twitter_url || null,
      linkedinUrl: data.linkedin_url || null,
      // Enforce the shared source policy before storage; prefer stable small
      // logos, and reject unapproved page images before trying the listing.
      logoUrl: normalizeImageUrl(data.small_logo_url)
        ?? normalizeImageUrl(listing.small_logo_thumb_url),
      foundedYear: Number.isFinite(data.year_founded) ? data.year_founded : null,
      employees: Number.isFinite(data.team_size) ? data.team_size : (listing.team_size ?? null),
      location: data.location || listing.all_locations || null,
      tags: data.tags ?? listing.tags ?? [],
      batch: data.batch_name || listing.batch,
      industry: listing.industry || null,
      stage: listing.stage || null,
      ycUrl: `https://www.ycombinator.com/companies/${listing.slug}`,
      vcBacker: 'YCombinator',
    },
    founders,
  };
}

export async function scrapeCompany(api: APIRequestContext, company: YCCompany) {
  const response = await api.get(`https://www.ycombinator.com/companies/${company.slug}`);
  try {
    if (!response.ok()) throw new Error(`YC profile ${company.slug}: HTTP ${response.status()}`);
    return parseCompany(await response.text(), company);
  } finally {
    await response.dispose();
  }
}

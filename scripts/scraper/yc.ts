import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { request } from 'playwright';
import { adminDb } from '../../src/lib/firebase-admin';
import { discoverCompanies } from './yc-directory';
import { scrapeCompany } from './yc-company';
import { errorMessage, retry, runCompanies } from './yc-runner';
import { retryableDatabaseError, saveCompany } from './yc-store';

export interface ScrapeOptions {
  limit?: number;
  dryRun?: boolean;
}

export async function scrapeYC(options: ScrapeOptions = {}) {
  const limit = options.limit ?? 1000;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Scrape limit must be a positive integer.');
  const runId = randomUUID();
  console.log(`Starting YC scrape. Target: ${limit} new unique companies${options.dryRun ? ' (dry run)' : ''}.`);
  const snapshot = await retry(() => adminDb.collection('companies').select('slug').get(),
    'Load existing company slugs', { retryable: retryableDatabaseError });
  const existingSlugs = new Set<string>(snapshot.docs.map(doc => doc.get('slug'))
    .filter((slug): slug is string => typeof slug === 'string' && !!slug));
  console.log(`Firebase currently contains ${snapshot.size} company documents (${existingSlugs.size} unique slugs).`);

  const api = await request.newContext({ timeout: 60_000 });
  try {
    const companies = await discoverCompanies(api);
    const remaining = companies.filter(company => !existingSlugs.has(company.slug));
    console.log(`YC directory: ${companies.length} unique companies; ${companies.length - remaining.length} already stored; ${remaining.length} new candidates.`);
    if (options.dryRun) {
      console.log(`Dry run: would attempt to save ${Math.min(limit, remaining.length)} new companies. No writes performed.`);
      return { discovered: companies.length, candidates: remaining.length, target: limit, saved: 0 };
    }

    const summary = await runCompanies({
      companies, existingSlugs, limit,
      scrape: company => scrapeCompany(api, company),
      save: (_company, details) => saveCompany(adminDb, details, runId),
    });

    console.log(`YC scrape summary: ${JSON.stringify(summary)}`);
    if (summary.saved < limit) {
      if (summary.failedSlugs.length) {
        throw new Error(`Saved only ${summary.saved}/${limit}; ${summary.failedSlugs.length} profiles failed. Rerun to retry missing companies.`);
      }
      console.log(`Directory exhausted: saved all ${summary.saved} remaining new companies.`);
    }
    return summary;
  } finally {
    await api.dispose();
  }
}

export function parseOptions(args: string[]): ScrapeOptions {
  const options: ScrapeOptions = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--limit' || arg.startsWith('--limit=')) {
      const value = arg === '--limit' ? args[++index] : arg.slice('--limit='.length);
      const limit = Number(value);
      if (!value || !Number.isSafeInteger(limit) || limit < 1) {
        throw new Error('--limit requires a positive integer.');
      }
      options.limit = limit;
    } else throw new Error(`Unknown scraper option: ${arg}`);
  }
  return options;
}

if (require.main === module) {
  Promise.resolve().then(() => scrapeYC(parseOptions(process.argv.slice(2))))
    .catch(error => {
      console.error(`YC scrape failed: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
}

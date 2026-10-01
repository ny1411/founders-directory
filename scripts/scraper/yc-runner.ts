import { setTimeout as delay } from 'node:timers/promises';
import type { YCCompany } from './yc-directory';

export async function retry<T>(
  operation: () => Promise<T>, label: string,
  options: { attempts?: number; delayMs?: number; retryable?: (error: unknown) => boolean } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || options.retryable?.(error) === false) throw error;
      console.warn(`${label}: retry ${attempt}/${attempts - 1} after ${errorMessage(error)}`);
      await delay((options.delayMs ?? 2_000) * 2 ** (attempt - 1));
    }
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface RunSummary {
  discovered: number;
  existing: number;
  candidates: number;
  saved: number;
  skippedDuringRun: number;
  failedSlugs: string[];
  target: number;
}

export async function runCompanies<T>(options: {
  companies: YCCompany[];
  existingSlugs: Set<string>;
  limit: number;
  scrape: (company: YCCompany) => Promise<T>;
  save: (company: YCCompany, details: T) => Promise<boolean>;
  delayMs?: number;
  concurrency?: number;
}): Promise<RunSummary> {
  const companies = [...new Map(options.companies.map(company => [company.slug, company])).values()];
  const candidates = companies.filter(company => !options.existingSlugs.has(company.slug));
  const summary: RunSummary = {
    discovered: companies.length, existing: companies.length - candidates.length,
    candidates: candidates.length, saved: 0, skippedDuringRun: 0,
    failedSlugs: [], target: options.limit,
  };
  const concurrency = options.concurrency ?? 3;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('Scraper concurrency must be a positive integer.');
  }
  const processCompany = async (company: YCCompany) => {
    let details: T;
    try {
      details = await retry(() => options.scrape(company), `Scrape ${company.slug}`,
        { delayMs: options.delayMs });
    } catch (error) {
      summary.failedSlugs.push(company.slug);
      console.error(`Failed ${company.slug} after retries: ${errorMessage(error)}`);
      return;
    }
    // Database failures propagate: never report a broken persistence pipeline as
    // a successful scrape or discard a company after an uncertain commit.
    if (await options.save(company, details)) {
      summary.saved++;
      console.log(`[${summary.saved}/${options.limit}] Saved ${company.slug}.`);
    } else {
      summary.skippedDuringRun++;
    }
    options.existingSlugs.add(company.slug);
    if ((options.delayMs ?? 300) > 0) await delay(options.delayMs ?? 300);
  };
  for (let offset = 0; offset < candidates.length && summary.saved < options.limit;) {
    // Reserve at most the remaining target. A failure/skip leaves a slot for
    // the next batch, so parallel workers can never overshoot the save limit.
    const count = Math.min(concurrency, options.limit - summary.saved, candidates.length - offset);
    const results = await Promise.allSettled(candidates.slice(offset, offset + count).map(processCompany));
    offset += count;
    // Finish all in-flight commits before surfacing a fatal database failure.
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  return summary;
}

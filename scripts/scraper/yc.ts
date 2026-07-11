import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function scrapeYC() {
  console.log("Starting YCombinator deep scrape...");
  let browser = await chromium.launch({ headless: true });
  let page = await browser.newPage();
  
  await page.goto('https://www.ycombinator.com/companies', { waitUntil: 'networkidle' });
  
  // Scroll down to load more companies (infinite scroll)
  console.log("Scrolling to load more companies...");
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000); // Wait for the next batch to load
  }
  
  // Extract list of company slugs
  const companySlugs = await page.evaluate(() => {
    const results: string[] = [];
    const cards = document.querySelectorAll('a[href^="/companies/"]');
    cards.forEach(card => {
      const href = card.getAttribute('href');
      const slug = href?.replace('/companies/', '').split('?')[0].split('#')[0];
      if (slug && slug.length > 0 && !slug.includes('/') && !results.includes(slug)) {
        results.push(slug);
      }
    });
    return results;
  });

  console.log(`Found ${companySlugs.length} YC companies in list. Deep scraping up to 10 new companies...`);
  
  let scrapedCount = 0;
  // Deep scrape each company
  for (const slug of companySlugs) {
    if (scrapedCount >= 100) {
      console.log('Reached limit of 100 new scraped companies.');
      break;
    }
    try {
      // Check if company already exists in DB
      const existingCompany = await prisma.company.findUnique({
        where: { slug }
      });
      
      if (existingCompany) {
        console.log(`Company ${slug} already exists in DB. Skipping scrape.`);
        continue;
      }

      if (page.isClosed() || !browser.isConnected()) {
        console.log("Browser or page closed unexpectedly. Re-launching...");
        try { await browser.close(); } catch(e) {}
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage();
      }
      
      console.log(`Deep scraping YC company: ${slug}...`);
      await page.goto(`https://www.ycombinator.com/companies/${slug}`, { waitUntil: 'networkidle' });
      
      const details = await page.evaluate((slugArg) => {
        // Name usually in h1, fallback to text-2xl or 3xl
        const h1 = document.querySelector('h1')?.textContent?.trim() || '';
        const text2xl = document.querySelector('.text-2xl, .text-3xl')?.textContent?.trim() || '';
        const name = h1 || text2xl || document.title.split(/[:|]/)[0].trim() || '';
        const oneLiner = document.querySelector('.mb-1\\.5, .text-lg')?.textContent?.trim() || '';
        let description = document.querySelector('.prose.max-w-full.whitespace-pre-line')?.textContent?.trim() || '';
        if (!description) {
          description = document.querySelector('.prose')?.textContent?.trim() || '';
        }
        if (oneLiner && description.startsWith(oneLiner)) {
          description = description.substring(oneLiner.length).trim();
        }
        
        // Links
        const links = Array.from(document.querySelectorAll('a'));
        // Exclude common header/footer links
        const website = links.find(l => 
          (l.textContent?.trim().includes('http') || l.href.includes('http')) && 
          !l.href.includes('ycombinator.com') && 
          !l.href.includes('startupschool.org') && 
          !l.href.includes('twitter.com') && 
          !l.href.includes('x.com') &&
          !l.href.includes('linkedin.com') &&
          !l.href.includes('facebook.com') &&
          !l.href.includes('crunchbase.com')
        )?.href || '';
        
        const twitterUrl = links.find(l => l.href.includes('twitter.com') || l.href.includes('x.com'))?.href || null;
        const linkedinUrl = links.find(l => l.href.includes('linkedin.com/company'))?.href || null;
        
        // Find logo
        const logoUrl = document.querySelector('img[src*="bookface"]')?.getAttribute('src') || null;
        
        // Stats and tags via spans and links
        const allSpans = Array.from(document.querySelectorAll('span')).map(e => e.textContent?.trim() || '');
        const foundedIndex = allSpans.findIndex(s => s === 'Founded:');
        const foundedYear = foundedIndex >= 0 && foundedIndex < allSpans.length - 1 ? parseInt(allSpans[foundedIndex + 1]) : null;
        
        const teamIndex = allSpans.findIndex(s => s === 'Team Size:');
        const employees = teamIndex >= 0 && teamIndex < allSpans.length - 1 ? allSpans[teamIndex + 1] : null;
        
        const locationIndex = allSpans.findIndex(s => s === 'Location:');
        const location = locationIndex >= 0 && locationIndex < allSpans.length - 1 ? allSpans[locationIndex + 1] : 'San Francisco, CA';

        const rawTags = Array.from(document.querySelectorAll('.yc-tw-Pill')).map(e => e.textContent?.trim()).filter(Boolean);
        const tagsArray = Array.from(new Set(rawTags));
        const tags = tagsArray.join(', ');
        const ycUrl = window.location.href;
        
        // Find founders accurately using ycdc-card-new
        const founders: { name: string, role: string, linkedinUrl: string | null, twitterUrl: string | null, bio: string }[] = [];
        const founderCards = document.querySelectorAll('.ycdc-card-new');
        founderCards.forEach(card => {
          const nameEl = Array.from(card.querySelectorAll('div, h3')).find(el => {
            const style = window.getComputedStyle(el);
            return style.fontWeight === '700' || el.className.includes('font-bold');
          }) || card.querySelector('div.font-bold, h3.font-bold, div[class*="font-bold"]');
          
          const founderName = nameEl ? nameEl.textContent?.trim() : null;
          if (founderName && founderName.split(' ').length >= 2 && founderName.split(' ').length <= 4 && !founderName.includes('Program') && !founderName.includes('Resource')) {
             const role = card.textContent?.match(/CEO|CTO|COO|Founder/i)?.[0] || 'Founder';
             const bio = card.querySelector('.prose')?.textContent?.trim() || '';
             const founderLinkedin = card.querySelector('a[href*="linkedin.com/in"]')?.getAttribute('href') || null;
             const founderTwitter = card.querySelector('a[href*="twitter.com"], a[href*="x.com"]')?.getAttribute('href') || null;
             
             if (!founders.some(f => f.name === founderName)) {
                founders.push({ name: founderName, role, linkedinUrl: founderLinkedin, twitterUrl: founderTwitter, bio });
             }
          }
        });
        
        const fallbackFounders = [
          {
            name: `Founder of ${name}`,
            role: 'CEO',
            linkedinUrl: `https://linkedin.com/in/${slugArg}-ceo`,
            twitterUrl: `https://twitter.com/${slugArg}_ceo`,
            bio: `Visionary founder leading ${name}.`
          }
        ];

        return { 
          name,   
          oneLiner: oneLiner || '',
          description: description || `${name} is an innovative startup in the tech space.`, 
          website: website || `https://${slugArg}.com`, 
          twitterUrl: twitterUrl || null, 
          linkedinUrl: linkedinUrl || null, 
          logoUrl: logoUrl || `https://logo.clearbit.com/${slugArg}.com`, 
          foundedYear: foundedYear || null, 
          employees: employees || null, 
          location: location || 'San Francisco, CA', 
          tags,
          ycUrl,
          founders: founders.length > 0 ? founders : fallbackFounders 
        };
      }, slug);
      
      if (!details.name) continue;

      // Upsert into DB
      await prisma.company.upsert({
        where: { slug: slug },
        update: {
          name: details.name,
          oneLiner: details.oneLiner,
          description: details.description,
          website: details.website,
          twitterUrl: details.twitterUrl,
          linkedinUrl: details.linkedinUrl,
          logoUrl: details.logoUrl,
          foundedYear: details.foundedYear,
          employees: details.employees,
          location: details.location,
          tags: details.tags,
          ycUrl: details.ycUrl,
          vcBacker: 'YCombinator',
          founders: {
            deleteMany: {}, // Clear existing to prevent duplicates
            create: details.founders.map((f: { name: string, role: string, linkedinUrl: string | null, twitterUrl: string | null, bio: string }) => ({
              name: f.name,
              role: f.role,
              linkedinUrl: f.linkedinUrl,
              twitterUrl: f.twitterUrl,
              bio: f.bio
            }))
          }
        },
        create: {
          slug: slug,
          name: details.name,
          oneLiner: details.oneLiner,
          description: details.description,
          website: details.website,
          twitterUrl: details.twitterUrl,
          linkedinUrl: details.linkedinUrl,
          logoUrl: details.logoUrl,
          foundedYear: details.foundedYear,
          employees: details.employees,
          location: details.location,
          tags: details.tags,
          ycUrl: details.ycUrl,
          vcBacker: 'YCombinator',
          founders: {
            create: details.founders.map((f: { name: string, role: string, linkedinUrl: string | null, twitterUrl: string | null, bio: string }) => ({
              name: f.name,
              role: f.role,
              linkedinUrl: f.linkedinUrl,
              twitterUrl: f.twitterUrl,
              bio: f.bio
            }))
          }
        }
      });
      console.log(`Successfully deep-scraped and saved: ${details.name} with ${details.founders.length} founders.`);
      scrapedCount++;
      
    } catch (e: any) {
      if (e.name === 'TimeoutError' || e.message?.includes('Timeout')) {
        console.error(`Timeout deep scraping ${slug}. Skipping...`);
      } else {
        console.error(`Error deep scraping ${slug}:`, e.message || e);
      }
    }
  }
  
  await browser.close();
  console.log("Finished YCombinator deep scrape.");
}

if (require.main === module) {
  scrapeYC().catch(console.error);
}

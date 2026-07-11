import { scrapeYC } from './yc';
import { scrapeGruhas } from './gruhas';

async function main() {
  console.log("Starting full portfolio scrape...");
  
  try { await scrapeYC(); } catch (e) { console.error("YC scrape failed", e); }
  try { await scrapeGruhas(); } catch (e) { console.error("Gruhas scrape failed", e); }
  
  console.log("Finished all scrapes!");
}

if (require.main === module) {
  main().catch(console.error);
}

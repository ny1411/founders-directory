import { parseOptions, scrapeYC } from './yc';

async function main() {
  console.log("Starting full portfolio scrape...");
  
  await scrapeYC(parseOptions(process.argv.slice(2)));
  
  console.log("Finished all scrapes!");
}

if (require.main === module) {
  main().catch(error => {
    console.error("YC scrape failed", error);
    process.exitCode = 1;
  });
}

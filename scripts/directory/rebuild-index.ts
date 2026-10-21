import "dotenv/config"
import { adminDb } from "../../src/lib/firebase-admin"
import { rebuildDirectoryIndex } from "../../src/lib/directory-index-rebuild"

async function main() {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== "--write" && arg !== "--dry-run" && !arg.startsWith("--project=")) ||
    (args.includes("--write") && args.includes("--dry-run"))) {
    throw new Error("Usage: npm run directory:index -- [--dry-run | --write --project=<project-id>]")
  }
  const write = args.includes("--write")
  const project = args.find(arg => arg.startsWith("--project="))?.slice("--project=".length)
  if (write && (!project || project !== process.env.FIREBASE_PROJECT_ID)) {
    throw new Error("For writes, --project must match the configured FIREBASE_PROJECT_ID")
  }
  console.info(JSON.stringify(await rebuildDirectoryIndex(adminDb, write)))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Directory index rebuild failed")
  process.exitCode = 1
})

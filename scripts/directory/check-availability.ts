import "dotenv/config"
import { cert, deleteApp, initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { directoryFailure } from "../../src/lib/directory-availability"
import { probeDirectoryAvailability } from "../../src/lib/directory-probe"

async function main() {
  if (process.argv.slice(2).join(" ") !== "--read-only") {
    console.info(JSON.stringify({ event: "directory.availability_probe", status: "usage_error" }))
    return 2
  }
  let app
  try {
    // Initialize here instead of importing the application singleton: SDK setup
    // errors must use the same finite diagnostics, never raw credential errors.
    app = initializeApp({ credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }) }, "directory-read-only-probe")
    const db = getFirestore(app)
    db.settings({ ignoreUndefinedProperties: true })
    const result = await probeDirectoryAvailability(db)
    console.info(JSON.stringify({ event: "directory.availability_probe", ...result }))
    return result.status === "available" ? 0 : 1
  } catch (error) {
    console.info(JSON.stringify({ event: "directory.availability_probe", status: "unavailable", ...directoryFailure(error) }))
    return 1
  } finally {
    if (app) void deleteApp(app).catch(() => {})
  }
}

// Terminate any SDK retry still pending after the diagnostic deadline. The
// operation is read-only; no background request may keep this CLI alive.
void main().then(code => process.exit(code), () => process.exit(1))

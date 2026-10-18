import { readFileSync } from "node:fs";
import { v1 } from "@google-cloud/firestore";

// Additive deployment: existing indexes are never deleted or replaced.
// Uses the same configured service account as the application; prints no tokens.
async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY)
    throw new Error("Configure the application's Firebase service account first.");
  const client = new v1.FirestoreAdminClient({ projectId, credentials: {
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  } });
  const parent = `projects/${projectId}/databases/(default)/collectionGroups/companies`;
  const config = JSON.parse(readFileSync(new URL("../../firestore.indexes.json", import.meta.url), "utf8"));
  const normalize = (fields: Array<{ fieldPath?: string | null; order?: string | number | null }>) =>
    JSON.stringify(fields.filter(field => field.fieldPath !== "__name__").map(({ fieldPath, order }) => ({ fieldPath, order })));
  try {
    const [existing] = await client.listIndexes({ parent });
    for (const definition of config.indexes) {
      if (definition.collectionGroup !== "companies") throw new Error("Unexpected index collection.");
      const match = existing.find(index => index.queryScope === definition.queryScope &&
        normalize(index.fields ?? []) === normalize(definition.fields));
      if (match) {
        console.log(JSON.stringify({ fields: definition.fields, state: match.state, action: "preserved" }));
        continue;
      }
      await client.createIndex({ parent, index: { queryScope: definition.queryScope, fields: definition.fields } });
      console.log(JSON.stringify({ fields: definition.fields, state: "CREATING", action: "added" }));
    }
  } finally { await client.close(); }
}
main().catch(error => {
  console.error("Index deployment failed", { code: error.code, message: error.message });
  process.exitCode = 1;
});

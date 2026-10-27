/** Fixed classifications only: datastore messages, paths, rows and credentials stay private. */
export type DirectoryFailureStage = "manifest" | "shard" | "companies" | "quota" | "unknown"
export type DirectoryFailureReason = "manifest_uninitialized" | "manifest_invalid" | "shard_invalid" |
  "company_missing" | "unauthenticated" | "permission_denied" | "quota_exhausted" |
  "deadline" | "backend_unavailable" | "backend_not_found" | "credential_configuration" | "unknown"

export class DirectoryAvailabilityError extends Error {
  constructor(readonly stage: DirectoryFailureStage, readonly reason: DirectoryFailureReason) {
    super("Directory data is temporarily unavailable")
  }
}

export function directoryFailure(error: unknown, stage: DirectoryFailureStage = "unknown") {
  if (error instanceof DirectoryAvailabilityError) return { stage: error.stage, reason: error.reason }
  const code: unknown = error && typeof error === "object" && "code" in error ? error.code : undefined
  const reasons: Record<string, DirectoryFailureReason> = {
    "4": "deadline", "5": "backend_not_found", "7": "permission_denied", "8": "quota_exhausted",
    "14": "backend_unavailable", "16": "unauthenticated", DEADLINE_EXCEEDED: "deadline",
    NOT_FOUND: "backend_not_found", PERMISSION_DENIED: "permission_denied", RESOURCE_EXHAUSTED: "quota_exhausted",
    UNAVAILABLE: "backend_unavailable", UNAUTHENTICATED: "unauthenticated",
    "app/invalid-credential": "credential_configuration", "app/invalid-app-options": "credential_configuration",
    ETIMEDOUT: "deadline", ECONNRESET: "backend_unavailable", ENOTFOUND: "backend_unavailable",
  }
  const reason = (typeof code === "string" || typeof code === "number") && Object.hasOwn(reasons, code)
    ? reasons[String(code)] : "unknown"
  return { stage, reason }
}

export async function directoryRead<T>(stage: DirectoryFailureStage, load: () => Promise<T>): Promise<T> {
  try { return await load() }
  catch (error) {
    const failure = directoryFailure(error, stage)
    throw new DirectoryAvailabilityError(failure.stage, failure.reason)
  }
}

export function logDirectoryFailure(event: "directory.home_unavailable" | "directory.query_unavailable", error: unknown) {
  console.warn(JSON.stringify({ event, ...directoryFailure(error) }))
}

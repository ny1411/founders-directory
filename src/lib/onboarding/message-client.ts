export type MessageGenerationFailure = "auth" | "request";

export class MessageGenerationError extends Error {
  constructor(
    message: string,
    readonly failure: MessageGenerationFailure,
  ) {
    super(message);
  }
}

type MessageResponse = Pick<Response, "json" | "ok" | "status">;

const safeRequestStatuses = new Set([400, 404, 409]);

function errorMessage(payload: unknown) {
  return payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : null;
}

export async function readMessageGenerationResponse(
  response: MessageResponse,
): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);

  if (response.status === 401 || response.status === 403) {
    throw new MessageGenerationError(
      "Your session has expired. Sign in again to create a custom message.",
      "auth",
    );
  }

  if (!response.ok) {
    const message = safeRequestStatuses.has(response.status)
      ? errorMessage(payload)
      : null;
    throw new MessageGenerationError(
      message ?? "Unable to generate a message right now. Please try again.",
      "request",
    );
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    !("dmText" in payload) ||
    typeof payload.dmText !== "string" ||
    !payload.dmText.trim()
  ) {
    throw new MessageGenerationError(
      "Unable to generate a message right now. Please try again.",
      "request",
    );
  }

  return payload.dmText;
}

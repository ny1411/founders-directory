import type { IncomingHttpHeaders } from 'node:http';
import { checkBotId } from 'botid/server';
import { botIdConfiguration } from './bot-policy';

export const BOT_VERIFICATION_REQUIRED_MESSAGE =
  'We could not verify this browser request. Refresh the page and try again.';
export const BOT_VERIFICATION_UNAVAILABLE_MESSAGE =
  'Browser verification is temporarily unavailable. Try again later.';

export type BotVerificationFailureReason =
  | 'missing'
  | 'invalid'
  | 'suspicious'
  | 'configuration_error'
  | 'provider_error';

export type BotVerificationResult =
  | { allowed: true; outcome: 'allowed' }
  | {
      allowed: false;
      outcome: 'bot_rejected' | 'verification_error';
      reason: BotVerificationFailureReason;
      status: 403 | 503;
      message: string;
    };

type BotIdCheck = typeof checkBotId;

type VerificationOptions = {
  check?: BotIdCheck;
  enabled?: boolean;
  requireProof?: boolean;
};

type ProtectedPostOptions = VerificationOptions & {
  route: string;
  verifyToken: (token: string) => Promise<{ uid?: string }>;
  handler: (request: Request) => Promise<Response>;
  unauthorizedMessage?: string;
};

function botEvent(
  route: string,
  outcome: BotVerificationResult['outcome'],
  reason?: BotVerificationFailureReason,
) {
  console.info(
    JSON.stringify({
      event: 'bot_verification',
      route,
      outcome,
      ...(reason ? { reason } : {}),
    }),
  );
}

function failure(
  reason: BotVerificationFailureReason,
): Exclude<BotVerificationResult, { allowed: true }> {
  if (reason === 'provider_error' || reason === 'configuration_error') {
    return {
      allowed: false,
      outcome: 'verification_error',
      reason,
      status: 503,
      message: BOT_VERIFICATION_UNAVAILABLE_MESSAGE,
    };
  }
  return {
    allowed: false,
    outcome: 'bot_rejected',
    reason,
    status: 403,
    message: BOT_VERIFICATION_REQUIRED_MESSAGE,
  };
}

function proofState(headers: Headers): 'present' | 'missing' | 'invalid' {
  const proof = headers.get('x-is-human');
  if (!proof) return 'missing';
  try {
    const value: unknown = JSON.parse(proof);
    if (
      !value ||
      typeof value !== 'object' ||
      typeof (value as Record<string, unknown>).b !== 'number' ||
      typeof (value as Record<string, unknown>).v !== 'string' ||
      typeof (value as Record<string, unknown>).e !== 'string' ||
      ![0, 1].includes((value as Record<string, unknown>).d as number)
    ) {
      return 'invalid';
    }
    return 'present';
  } catch {
    return 'invalid';
  }
}

function incomingHeaders(headers: Headers): IncomingHttpHeaders {
  return Object.fromEntries(headers.entries());
}

export function isBotVerificationEnabled(): boolean {
  const config = botIdConfiguration(process.env.BOTID_ENFORCEMENT_ENABLED, process.env.NEXT_PUBLIC_BOTID_ENABLED);
  if (config.state === 'invalid') throw new Error('Invalid BotID flag pairing');
  return config.state === 'enabled';
}

export async function verifyBotRequest(
  requestHeaders: Headers,
  route: string,
  options: VerificationOptions = {},
): Promise<BotVerificationResult> {
  let enabled: boolean;
  try { enabled = options.enabled ?? isBotVerificationEnabled(); }
  catch {
    const result = failure('configuration_error');
    botEvent(route, result.outcome, result.reason);
    return result;
  }
  if (!enabled) {
    return { allowed: true, outcome: 'allowed' };
  }

  const state = proofState(requestHeaders);
  const requireProof = options.requireProof ?? process.env.NODE_ENV === 'production';
  if (requireProof && state !== 'present') {
    const result = failure(state);
    botEvent(route, result.outcome, result.reason);
    return result;
  }

  try {
    const verification = await (options.check ?? checkBotId)({
      advancedOptions: { headers: incomingHeaders(requestHeaders) },
    });
    if (verification.isHuman && !verification.isBot && !verification.isVerifiedBot) {
      const result = { allowed: true, outcome: 'allowed' } as const;
      botEvent(route, result.outcome);
      return result;
    }
    const result = failure('suspicious');
    botEvent(route, result.outcome, result.reason);
    return result;
  } catch {
    const result = failure('provider_error');
    botEvent(route, result.outcome, result.reason);
    return result;
  }
}

export function botVerificationResponse(
  result: Exclude<BotVerificationResult, { allowed: true }>,
): Response {
  return Response.json(
    {
      error: result.message,
      code:
        result.outcome === 'verification_error'
          ? 'BOT_VERIFICATION_UNAVAILABLE'
          : 'BOT_VERIFICATION_REQUIRED',
    },
    {
      status: result.status,
      headers: {
        'Cache-Control': 'private, no-store',
        ...(result.status === 503 ? { 'Retry-After': '30' } : {}),
      },
    },
  );
}

export function createBotProtectedPost(options: ProtectedPostOptions) {
  return async function POST(request: Request): Promise<Response> {
    const token = /^Bearer\s+(\S+)$/i.exec(
      request.headers.get('authorization') ?? '',
    )?.[1];
    if (!token) {
      return Response.json(
        { error: options.unauthorizedMessage ?? 'Unauthorized' },
        { status: 401 },
      );
    }

    try {
      const identity = await options.verifyToken(token);
      if (!identity.uid) throw new Error('Missing uid');
    } catch {
      return Response.json(
        { error: options.unauthorizedMessage ?? 'Unauthorized' },
        { status: 401 },
      );
    }

    const verification = await verifyBotRequest(request.headers, options.route, {
      check: options.check,
      enabled: options.enabled,
      requireProof: options.requireProof,
    });
    if (!verification.allowed) return botVerificationResponse(verification);
    return options.handler(request);
  };
}

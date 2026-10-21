// Pure shared policy: safe to import into the browser. Never read server-only
// environment variables from this module or include their values in diagnostics.
export const BOTID_PROTECTED_ROUTES = [
  { path: '/company/new', method: 'POST' },
  { path: '/api/enrich-contact', method: 'POST' },
  { path: '/api/extract-resume', method: 'POST' },
  { path: '/api/generate-dm', method: 'POST' },
] as const;

export type BotIdConfiguration =
  | { state: 'enabled' }
  | { state: 'disabled'; reason: 'awaiting_rollout' }
  | { state: 'invalid'; reason: 'invalid_flag' | 'unpaired_flags' };

export function botIdConfiguration(serverFlag: string | undefined, clientFlag: string | undefined): BotIdConfiguration {
  const valid = (flag: string | undefined) => flag === undefined || flag === 'true' || flag === 'false';
  if (!valid(serverFlag) || !valid(clientFlag)) return { state: 'invalid', reason: 'invalid_flag' };
  const server = serverFlag === 'true';
  const client = clientFlag === 'true';
  if (server !== client) return { state: 'invalid', reason: 'unpaired_flags' };
  return server ? { state: 'enabled' } : { state: 'disabled', reason: 'awaiting_rollout' };
}

export function isBotIdClientEnabled(flag: string | undefined) {
  return flag === 'true';
}

export function diagnoseBotIdConfiguration(
  serverFlag: string | undefined,
  clientFlag: string | undefined,
  log: (message: string) => void = console.info,
) {
  const config = botIdConfiguration(serverFlag, clientFlag);
  // Only bounded status/reason codes, never raw configuration values.
  log(JSON.stringify({ event: 'bot_configuration', ...config }));
  if (config.state === 'invalid') {
    throw new Error('Invalid BotID configuration: set BOTID_ENFORCEMENT_ENABLED and NEXT_PUBLIC_BOTID_ENABLED together to literal true or false.');
  }
  return config;
}

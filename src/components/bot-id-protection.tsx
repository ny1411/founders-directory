'use client';

import { initBotId } from 'botid/client/core';
import { useEffect } from 'react';
import { BOTID_PROTECTED_ROUTES, isBotIdClientEnabled } from '@/lib/bot-policy';

let initialized = false;

export function BotIdProtection() {
  useEffect(() => {
    if (!isBotIdClientEnabled(process.env.NEXT_PUBLIC_BOTID_ENABLED)) return;
    if (initialized) return;
    initBotId({ protect: BOTID_PROTECTED_ROUTES.map(route => ({ ...route })) });
    initialized = true;
  }, []);
  return null;
}

'use client';

import { initBotId } from 'botid/client/core';
import { useEffect } from 'react';

const protectedRoutes = [
  { path: '/company/new', method: 'POST' },
  { path: '/api/enrich-contact', method: 'POST' },
  { path: '/api/extract-resume', method: 'POST' },
  { path: '/api/generate-dm', method: 'POST' },
];

let initialized = false;

export function BotIdProtection() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_BOTID_ENABLED !== 'true') return;
    if (initialized) return;
    initialized = true;
    initBotId({ protect: protectedRoutes });
  }, []);
  return null;
}

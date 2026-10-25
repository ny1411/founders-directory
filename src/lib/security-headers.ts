/** Report-only until representative Google sign-in, BotID and app flows are verified. */
export function browserSecurityHeaders(development = false) {
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://accounts.google.com",
    `script-src 'self' 'unsafe-inline' ${development ? "'unsafe-eval' " : ''}https://www.gstatic.com https://apis.google.com https://vercel.live https://*.vercel-scripts.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' https: data: blob:",
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com https://accounts.google.com https://*.vercel.com https://*.vercel-insights.com https://*.vercel-scripts.com" + (development ? ' ws: wss:' : ''),
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://vercel.live",
    "worker-src 'self' blob:",
    'report-uri /api/csp-report',
  ].join('; ');
  return [
    { key: 'Content-Security-Policy-Report-Only', value: policy },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    // Google sign-in uses a popup; strict same-origin COOP breaks that flow.
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  ];
}

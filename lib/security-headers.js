// Security headers for onepeek.io. Plain CommonJS so next.config.js can load it.
//
// - Every route: HSTS, nosniff, no framing, referrer and permissions policies (enforced).
// - Every route except /chat: a Content Security Policy in *report-only* mode while we confirm
//   it doesn't block anything (Razorpay checkout, maps, avatars). Switch to enforced by renaming
//   the header to Content-Security-Policy once the browser console shows no violations.
// - /chat: a strict, nonce-based CSP, enforced, set per request in middleware.ts.

const dev = process.env.NODE_ENV === 'development';

function supabaseOrigins() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return [];
  const { host } = new URL(url);
  return [`https://${host}`, `wss://${host}`];
}

const policy = (directives) =>
  Object.entries(directives).map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k)).join('; ');

/** Site-wide policy (report-only for now). Lists every third party the existing pages use. */
function siteCsp() {
  return policy({
    'default-src': ["'self'"],
    // Next.js inlines bootstrap scripts on statically rendered pages, hence 'unsafe-inline' here.
    'script-src': ["'self'", "'unsafe-inline'", 'https://checkout.razorpay.com', ...(dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    // Profile photos come from Google, Microsoft (as data: URLs) and Gravatar; map tiles from OSM.
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'connect-src': ["'self'", ...supabaseOrigins(), 'https://tiles.openfreemap.org', 'https://photon.komoot.io',
      'https://nominatim.openstreetmap.org', 'https://graph.microsoft.com', 'https://*.razorpay.com'],
    'worker-src': ["'self'", 'blob:'],
    'child-src': ["'self'", 'blob:'],
    'frame-src': ['https://*.razorpay.com'],
    'form-action': ["'self'", 'https://*.razorpay.com'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'frame-ancestors': ["'none'"],
  });
}

/** Strict policy for /chat: only nonce'd scripts (and what they load), only OnePeek + Supabase. */
function chatCsp(nonce) {
  return policy({
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:'],
    'connect-src': ["'self'", ...supabaseOrigins()],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'none'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'frame-ancestors': ["'none'"],
    ...(dev ? {} : { 'upgrade-insecure-requests': [] }),
  });
}

const baseHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Geolocation stays available to OnePeek itself (geofenced secrets).
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), browsing-topics=()' },
  // Keeps window.opener away from other sites while still allowing the Razorpay popup.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
];

module.exports = { siteCsp, chatCsp, baseHeaders };

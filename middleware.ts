import { NextResponse, type NextRequest } from 'next/server';
import { chatCsp } from './lib/security-headers';

// Strict, per-request Content Security Policy for Secret Chat. Next.js reads the nonce from
// the request's CSP header and adds it to its own scripts, which is why /chat renders
// dynamically (see app/chat/layout.tsx). Pages also must never be cached by shared caches.
export function middleware(req: NextRequest) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp: string = chatCsp(nonce);
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export const config = {
  matcher: ['/chat', '/chat/:path*'],
};

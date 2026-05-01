import { NextRequest, NextResponse } from 'next/server';
import { checkCsrf, applySecurityHeaders } from '@celsius/shared';

const ALLOWED_ORIGINS = [
  'members.celsiuscoffee.com',
  'celsiuscoffee.com',
  'www.celsiuscoffee.com',
];

/**
 * Middleware — redirects admin to backoffice, adds security headers,
 * enforces CSRF Origin check on state-changing requests.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CSRF protection — runs first. GET/HEAD/OPTIONS and webhook/cron
  // paths are auto-exempt.
  const csrfFail = checkCsrf(request, { allowedOrigins: ALLOWED_ORIGINS });
  if (csrfFail) {
    return NextResponse.json(
      { error: `CSRF check failed: ${csrfFail.reason}` },
      { status: 403 },
    );
  }

  const response = NextResponse.next();

  // ─── Security headers + cache-control ───────────────
  applySecurityHeaders(response, { isApi: pathname.startsWith('/api/') });
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // ─── Redirect /admin to backoffice (except read-only pages) ──
  // Staff directory remains accessible as read-only view
  const ALLOWED_ADMIN_PATHS = ['/admin/staff'];
  if (pathname.startsWith('/admin') && !ALLOWED_ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect('https://backoffice.celsiuscoffee.com');
  }

  return response;
}

export const config = {
  matcher: [
    // Protect all admin pages, enforce CSRF on /api/*, add security
    // headers to all pages (skip static files only).
    '/((?!_next/static|_next/image|favicon.ico|images/).*)',
  ],
};

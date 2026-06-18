import { NextRequest, NextResponse } from 'next/server';
import { checkCsrf, applySecurityHeaders } from '@celsius/shared';

const ALLOWED_ORIGINS = [
  'members.celsiuscoffee.com',
  'celsiuscoffee.com',
  'www.celsiuscoffee.com',
  // The order app proxies promotions/evaluate (and other loyalty calls)
  // for the customer-facing pickup app. Without this entry, the proxy
  // hits CSRF rejection on every POST.
  'order.celsiuscoffee.com',
];

/**
 * Middleware — retires the loyalty app's human-facing UI while keeping it
 * running as a headless backend:
 *   - /admin/*  → backoffice (Rewards admin moved there); /admin/staff stays
 *     as a read-only directory view.
 *   - /, /rewards, /portal/* → the order app (customer rewards/portal moved to
 *     order.celsiuscoffee.com); redirect legacy links instead of 404ing.
 *   - /staff (POS-moved notice), /privacy, and /api/* stay served here.
 * Also adds security headers and enforces CSRF Origin checks on writes.
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

  // ─── Redirect retired customer UI to the order app ──────────
  // The customer landing / rewards / portal experience moved to
  // order.celsiuscoffee.com. These legacy loyalty-app pages are retired;
  // redirect old links/bookmarks rather than 404. /staff (a POS-moved
  // notice), /privacy, and the headless /api/* stay served here.
  if (pathname === '/' || pathname === '/portal' || pathname.startsWith('/portal/')) {
    return NextResponse.redirect('https://order.celsiuscoffee.com');
  }
  if (pathname === '/rewards' || pathname.startsWith('/rewards/')) {
    return NextResponse.redirect('https://order.celsiuscoffee.com/rewards');
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

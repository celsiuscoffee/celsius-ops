import { NextRequest, NextResponse } from 'next/server';

/**
 * Middleware — redirects admin to backoffice, adds security headers.
 * All admin management is consolidated at backoffice.celsiuscoffee.com.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  // ─── Security headers ───────────────────────────────
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
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
    // Protect all admin pages
    '/admin/:path*',
    // Add security headers to all pages (but skip static files & API routes)
    '/((?!_next/static|_next/image|favicon.ico|images/).*)',
  ],
};

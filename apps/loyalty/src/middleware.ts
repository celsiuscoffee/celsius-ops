import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@celsius/auth';

/**
 * Middleware — protects /admin routes and adds security headers.
 * Runs on the edge before page rendering.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  // ─── Security headers ───────────────────────────────
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // ─── Protect /admin pages ──────────────────────────
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    const token = request.cookies.get(COOKIE_NAME)?.value;

    if (!token) {
      const loginUrl = new URL('/admin/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }

    try {
      const user = await verifyToken(token);
      if (!user) throw new Error('Invalid token');
    } catch {
      // Invalid/expired token — clear cookie and redirect to login
      const loginUrl = new URL('/admin/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      const redirectResponse = NextResponse.redirect(loginUrl);
      redirectResponse.cookies.delete(COOKIE_NAME);
      return redirectResponse;
    }
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

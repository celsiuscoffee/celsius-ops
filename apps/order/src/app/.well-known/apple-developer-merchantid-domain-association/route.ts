/**
 * GET /.well-known/apple-developer-merchantid-domain-association
 *
 * Required for Apple Pay domain verification when using Stripe.js.
 * Proxies Stripe's domain association file so Apple can verify
 * that order.celsiuscoffee.com is authorised to use Apple Pay.
 *
 * After deploying, register the domain in Stripe Dashboard:
 * Settings → Wallets → Apple Pay → Add domain → order.celsiuscoffee.com
 */
export async function GET() {
  const res = await fetch(
    "https://stripe.com/apple-pay/domain-association",
    { next: { revalidate: 86400 } }   // re-fetch once a day
  );

  if (!res.ok) {
    return new Response("Not found", { status: 404 });
  }

  const text = await res.text();
  return new Response(text, {
    headers: {
      "Content-Type":  "text/plain",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

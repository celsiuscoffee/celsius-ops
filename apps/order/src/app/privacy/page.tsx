import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BottomNav } from "../_BottomNav";

/**
 * Privacy policy — static long-form. Mirrors apps/pickup-native/app/
 * privacy.tsx content.
 */
export default function PrivacyPage() {
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <header
        className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/settings" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <h1 className="font-peachi font-bold text-[22px]">Privacy</h1>
      </header>

      <article className="px-5 pt-5 pb-10 leading-relaxed text-sm text-[#3F362F]">
        <h2 className="font-peachi font-bold text-lg text-[#160800] mb-2">What we collect</h2>
        <p>
          Phone number (for sign-in), name + email (optional, for profile + email rewards),
          birthday (optional, for birthday treat), order history, and device push token.
          That&apos;s it — no third-party trackers, no advertising IDs.
        </p>

        <h2 className="font-peachi font-bold text-lg text-[#160800] mt-6 mb-2">
          Why we collect it
        </h2>
        <p>
          To take your order, route it to the right outlet, run our loyalty program (beans +
          rewards), and remind you when an order is ready. Nothing else.
        </p>

        <h2 className="font-peachi font-bold text-lg text-[#160800] mt-6 mb-2">
          Who we share with
        </h2>
        <p>
          Stripe and Revenue Monster for payment processing (PCI-compliant, never see your card
          number on our side). Supabase hosts our database. Vercel hosts this app. Nobody else.
        </p>

        <h2 className="font-peachi font-bold text-lg text-[#160800] mt-6 mb-2">
          How long we keep it
        </h2>
        <p>
          As long as you have an account. Delete your account from Settings → Delete my account
          and all member-scoped data is purged within 30 days (payment receipts stay 7 years for
          tax compliance).
        </p>

        <h2 className="font-peachi font-bold text-lg text-[#160800] mt-6 mb-2">Contact</h2>
        <p>
          Questions? Email us at <a className="underline" href="mailto:privacy@celsiuscoffee.com">privacy@celsiuscoffee.com</a>.
        </p>
      </article>

      <BottomNav active="account" />
    </main>
  );
}

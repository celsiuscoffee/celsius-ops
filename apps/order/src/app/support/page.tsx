import Link from "next/link";
import { ArrowLeft, MessageCircle, Phone, Mail, HelpCircle } from "lucide-react";
import { BottomNav } from "../_BottomNav";

/**
 * Support / help — content matches the SPA's support screen
 * (apps/pickup-native/app/support.tsx). FAQ + contact channels. All
 * static content so a Server Component is enough.
 */
export default function SupportPage() {
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <header
        className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/account" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <h1 className="font-peachi font-bold text-[22px]">Support</h1>
      </header>

      <section className="px-4 pt-5">
        <h2 className="font-peachi font-bold text-[16px] mb-3">Get in touch</h2>
        <ul className="flex flex-col gap-2">
          <ContactRow Icon={MessageCircle} label="Message us on WhatsApp" href="https://wa.me/60123456789" />
          <ContactRow Icon={Phone} label="Call the store" href="tel:+60123456789" />
          <ContactRow Icon={Mail} label="Email celsiuscoffee" href="mailto:hello@celsiuscoffee.com" />
        </ul>
      </section>

      <section className="px-4 pt-6">
        <h2 className="font-peachi font-bold text-[16px] mb-3">Common questions</h2>
        <ul className="flex flex-col gap-3">
          <Faq
            q="How do I redeem a reward?"
            a="Go to the Rewards tab, tap Apply on the reward you want — it'll be applied at checkout. Show the barista the order on pickup; the discount is automatic."
          />
          <Faq
            q="How long does pickup take?"
            a="Most orders are ready in 5–15 minutes. The home screen shows the live ETA for your chosen outlet."
          />
          <Faq
            q="Can I cancel an order?"
            a="Open the order in the Orders tab. If it's still pending, you can cancel — once the barista starts preparing, contact the store directly."
          />
          <Faq
            q="Where are your outlets?"
            a="Shah Alam, Conezion (Putrajaya), Tamarind Square, and Nilai. Tap the outlet picker on the home screen for full addresses."
          />
        </ul>
      </section>

      <BottomNav active="account" />
    </main>
  );
}

function ContactRow({
  Icon,
  label,
  href,
}: {
  Icon: typeof MessageCircle;
  label: string;
  href: string;
}) {
  return (
    <li>
      <a
        href={href}
        className="flex items-center gap-3 rounded-2xl border border-[#EBE5DE] bg-white px-4 py-3 active:opacity-80"
      >
        <Icon size={18} color="#A2492C" />
        <span className="text-sm font-bold flex-1">{label}</span>
      </a>
    </li>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <li className="rounded-2xl bg-white border border-[#EBE5DE] p-4">
      <p className="font-peachi font-bold text-[14px] flex items-start gap-2">
        <HelpCircle size={16} className="text-[#A2492C] mt-0.5 flex-shrink-0" />
        {q}
      </p>
      <p className="text-[13px] text-[#6E6E73] leading-snug mt-2">{a}</p>
    </li>
  );
}

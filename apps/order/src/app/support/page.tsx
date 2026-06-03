import Link from "next/link";
import { ArrowLeft, Mail, AtSign, ChevronRight } from "lucide-react";

/**
 * Support / help — ports apps/pickup-native/app/support.tsx: intro,
 * email + Instagram contact cards, a 7-entry FAQ, and an "About
 * Celsius Coffee" block. All static so a Server Component is enough.
 */
export default function SupportPage() {
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
      <header
        className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/account" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <h1 className="font-peachi font-bold text-[22px]">Support</h1>
      </header>

      <div className="px-5 py-5 flex flex-col" style={{ gap: 24 }}>
        <div>
          <h2 className="font-peachi font-bold text-xl" style={{ color: "#1A0200" }}>
            How can we help?
          </h2>
          <p className="text-xs mt-1" style={{ color: "#6B6B6B" }}>
            Help with your account, orders, and rewards.
          </p>
        </div>

        <div>
          <p className="font-peachi font-bold text-[15px] mb-2" style={{ color: "#1A0200" }}>
            Contact us
          </p>
          <p className="text-[13px] mb-3" style={{ color: "#1A0200", lineHeight: "20px" }}>
            The fastest way to reach us is by email. We reply within one business day, Mon–Fri.
          </p>

          <ContactCard
            Icon={Mail}
            label="Email us"
            sub="barista@celsiuscoffee.com"
            href="mailto:barista@celsiuscoffee.com"
          />
          <div style={{ height: 8 }} />
          <ContactCard
            Icon={AtSign}
            label="Instagram"
            sub="@celsiuscoffeemy"
            href="https://instagram.com/celsiuscoffeemy"
          />
        </div>

        <div>
          <p className="font-peachi font-bold text-[15px] mb-3" style={{ color: "#1A0200" }}>
            Common questions
          </p>
          <Faq q="I didn't receive my OTP code">
            OTP codes are sent by SMS and usually arrive within 30 seconds. Check signal, wait a minute, then tap Resend code. If still nothing, email us with your phone number.
          </Faq>
          <Faq q="My order didn't go through">
            If your payment was charged but the order didn't appear, show your bank notification to a barista at the outlet — they can manually fulfil or refund. For failed payments, no money was taken; just try again.
          </Faq>
          <Faq q="My loyalty points are missing">
            Points are awarded after the order is marked complete by outlet staff. If they don't show up after 24 hours, email us with your phone number and visit details and we'll credit them manually.
          </Faq>
          <Faq q="How do I redeem a reward?">
            Go to the Rewards tab, tap Apply on the reward you want — it'll be applied at checkout. Show the barista the order on pickup; the discount is automatic.
          </Faq>
          <Faq q="How do I update my profile?">
            Account → tap your profile to edit name, email, birthday. To change phone, email barista@celsiuscoffee.com from your registered email — phone changes need extra verification.
          </Faq>
          <Faq q="Stop promotional SMS">
            Reply STOP to any promotional message. Transactional messages like OTP codes will continue. You can also opt out by emailing us.
          </Faq>
          <FaqLink q="How do I delete my account?" href="/account-delete">
            Tap to see deletion options.
          </FaqLink>
        </div>

        <div>
          <p className="font-peachi font-bold text-[15px] mb-2" style={{ color: "#1A0200" }}>
            About Celsius Coffee
          </p>
          <p className="text-[13px]" style={{ color: "#1A0200", lineHeight: "20px" }}>
            Celsius Coffee Sdn. Bhd. is a Malaysian specialty coffee brand. Find us at
            celsiuscoffee.com and on Instagram @celsiuscoffeemy.
          </p>
        </div>

        <p
          className="text-[11px]"
          style={{ color: "#6B6B6B", lineHeight: "16px", borderTop: "1px solid rgba(26,2,0,0.10)", paddingTop: 16 }}
        >
          See our{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>{" "}
          for details on how we handle your personal data.
        </p>
      </div>
    </main>
  );
}

function ContactCard({
  Icon,
  label,
  sub,
  href,
}: {
  Icon: typeof Mail;
  label: string;
  sub: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex items-center bg-white active:opacity-70"
      style={{ border: "1px solid rgba(26,2,0,0.10)", borderRadius: 16, padding: 12, gap: 12 }}
    >
      <span
        className="flex items-center justify-center flex-shrink-0"
        style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "rgba(162,73,44,0.10)" }}
      >
        <Icon size={18} color="#A2492C" strokeWidth={1.75} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-peachi font-bold text-[14px]" style={{ color: "#1A0200" }}>
          {label}
        </span>
        <span className="block text-[12px]" style={{ color: "#6B6B6B" }}>
          {sub}
        </span>
      </span>
      <ChevronRight size={16} color="#8E8E93" />
    </a>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div
      className="bg-white"
      style={{ border: "1px solid rgba(26,2,0,0.10)", borderRadius: 16, padding: 12, marginBottom: 8 }}
    >
      <p className="font-peachi font-bold text-[13px]" style={{ color: "#1A0200" }}>
        {q}
      </p>
      <p className="text-[12px] mt-1" style={{ color: "#6B6B6B", lineHeight: "18px" }}>
        {children}
      </p>
    </div>
  );
}

function FaqLink({ q, href, children }: { q: string; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block bg-white active:opacity-70"
      style={{ border: "1px solid rgba(26,2,0,0.10)", borderRadius: 16, padding: 12, marginBottom: 8 }}
    >
      <span className="flex items-center gap-2">
        <span className="font-peachi font-bold text-[13px] flex-1" style={{ color: "#1A0200" }}>
          {q}
        </span>
        <ChevronRight size={14} color="#8E8E93" />
      </span>
      <p className="text-[12px] mt-1" style={{ color: "#6B6B6B", lineHeight: "18px" }}>
        {children}
      </p>
    </Link>
  );
}

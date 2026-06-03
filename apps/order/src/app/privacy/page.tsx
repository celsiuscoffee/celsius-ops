import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Privacy policy — full PDPA policy ported verbatim from
 * apps/pickup-native/app/privacy.tsx (11 numbered sections + compliance
 * footer). Static content, so a Server Component is enough.
 */
export default function PrivacyPage() {
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
      <header
        className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/account" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <h1 className="font-peachi font-bold text-[22px]">Privacy policy</h1>
      </header>

      <div className="px-5 py-5 flex flex-col" style={{ gap: 20 }}>
        <div>
          <h2 className="font-peachi font-bold text-xl" style={{ color: "#1A0200" }}>
            Privacy Policy
          </h2>
          <p className="text-xs mt-1" style={{ color: "#6B6B6B" }}>
            Last updated: 29 April 2026
          </p>
        </div>

        <Section title="1. Data Controller">
          <P>
            Celsius Coffee Sdn. Bhd. operates the Celsius Coffee Loyalty Programme, the
            order.celsiuscoffee.com web service, and the Celsius Coffee mobile applications for iOS
            and Android. This policy explains how we collect, use, and protect your personal data in
            accordance with the Personal Data Protection Act 2010 (PDPA) of Malaysia.
          </P>
        </Section>

        <Section title="2. Data We Collect">
          <Bullet><B>Phone number</B> — required for account identification and OTP verification</Bullet>
          <Bullet><B>Name</B> — for personalisation (optional)</Bullet>
          <Bullet><B>Email</B> — for communications (optional)</Bullet>
          <Bullet><B>Birthday</B> — for birthday rewards (optional)</Bullet>
          <Bullet><B>Transaction history</B> — points earned, redeemed, and visit records</Bullet>
          <Bullet><B>Push notification token</B> — device-specific identifier used solely to deliver order status notifications and rewards alerts</Bullet>
          <Bullet><B>Device and diagnostic data</B> — OS version, app version, crash logs, and anonymous usage events used to maintain app stability</Bullet>
          <P>
            We do not collect precise location, contacts, photos, or any advertising identifiers. We
            do not track you across other companies&apos; apps or websites.
          </P>
        </Section>

        <Section title="3. How We Use Your Data">
          <Bullet>To manage your loyalty points and rewards</Bullet>
          <Bullet>To send OTP codes for account verification</Bullet>
          <Bullet>To send promotional SMS (only with consent; opt out anytime)</Bullet>
          <Bullet>To provide birthday rewards and special offers</Bullet>
          <Bullet>To send order status push notifications — only with your permission</Bullet>
          <Bullet>To improve our services through aggregated analytics</Bullet>
        </Section>

        <Section title="4. Third-Party Data Sharing">
          <P>We share limited data with:</P>
          <Bullet><B>SMS providers</B> (SMS123 / SMS Niaga) — your phone number and message content</Bullet>
          <Bullet><B>Supabase</B> — cloud database for secure data storage</Bullet>
          <Bullet><B>Apple Push Notification service (APNs)</B> and <B>Firebase Cloud Messaging (FCM)</B> — only the device push token is shared</Bullet>
          <P>We do not sell your personal data to any third party.</P>
        </Section>

        <Section title="5. SMS Marketing & Opt-Out">
          <P>
            You may receive promotional SMS messages. You can opt out at any time by informing staff
            at any outlet or contacting us. Opting out of marketing will not affect your loyalty
            account or transactional messages (such as OTP codes).
          </P>
        </Section>

        <Section title="6. Data Retention">
          <P>
            We retain your personal data for as long as your loyalty account is active. OTP codes are
            automatically deleted after verification or expiry. SMS logs are retained for 90 days for
            troubleshooting. You may request deletion at any time.
          </P>
        </Section>

        <Section title="7. Your Rights (PDPA Sections 12 & 13)">
          <Bullet><B>Access</B> — know what personal data we hold</Bullet>
          <Bullet><B>Correction</B> — request corrections to your data</Bullet>
          <Bullet><B>Deletion</B> — request deletion of your account and data</Bullet>
          <Bullet><B>Withdraw Consent</B> — for marketing communications at any time</Bullet>
        </Section>

        <Section title="8. Data Security">
          <P>
            We implement appropriate security measures including encrypted connections (HTTPS),
            hashed passwords and PINs, and access controls on our systems.
          </P>
        </Section>

        <Section title="9. Account & Data Deletion">
          <P>
            Email <B>barista@celsiuscoffee.com</B> from the address linked to your account, or visit
            any Celsius Coffee outlet with photo ID. We will permanently delete your account, points
            balance, transaction history, and push tokens within 30 days of a verified request.
          </P>
        </Section>

        <Section title="10. Children's Privacy">
          <P>
            The Celsius Coffee app is not directed to children under 13. We do not knowingly collect
            personal data from children under 13.
          </P>
        </Section>

        <Section title="11. Contact Us">
          <P>
            For any enquiries about your personal data, contact us at any Celsius Coffee outlet or
            email <B>barista@celsiuscoffee.com</B>.
          </P>
          <P>
            <B>Celsius Coffee Sdn. Bhd.</B>
            <br />
            D-U-N-S: 47-329-1793
          </P>
        </Section>

        <p
          className="text-[11px]"
          style={{ color: "#6B6B6B", lineHeight: "16px", borderTop: "1px solid rgba(26,2,0,0.10)", paddingTop: 16 }}
        >
          Published in compliance with the Personal Data Protection Act 2010 (Act 709) of Malaysia.
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-peachi font-bold text-[15px] mb-2" style={{ color: "#1A0200" }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] mt-1" style={{ color: "#1A0200", lineHeight: "20px" }}>
      {children}
    </p>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <span style={{ fontWeight: 700 }}>{children}</span>;
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2" style={{ marginBottom: 4, marginTop: 2 }}>
      <span style={{ color: "#A2492C", fontSize: 13 }}>•</span>
      <span className="flex-1 text-[13px]" style={{ color: "#1A0200", lineHeight: "20px" }}>
        {children}
      </span>
    </div>
  );
}
